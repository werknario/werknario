import {
  isTextBlock,
  isToolUseBlock,
  type ContentBlock,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
  type Message,
  type ToolDefinition,
  type ToolResultBlock,
  type ToolUseBlock,
} from "./types.js";
import { TokenLedger, type TokenTotals } from "./tokens.js";

/** Calls the model for one turn. In the extension this hits the proxy. */
export type LlmCaller = (req: LlmRequest) => Promise<LlmResponse>;

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

/** Executes one tool call. In the extension this uses VS Code + GitLab APIs. */
export type ToolExecutor = (
  toolUse: ToolUseBlock,
) => Promise<ToolExecutionResult>;

export interface AgentEvents {
  onTurn?: (turn: number) => void;
  onAssistantText?: (text: string) => void;
  onToolUse?: (block: ToolUseBlock) => void;
  onToolResult?: (block: ToolUseBlock, result: ToolExecutionResult) => void;
  /** Fires after every model turn that reports usage, with the running totals. */
  onUsage?: (usage: LlmUsage, totals: TokenTotals) => void;
}

/** Context a per-turn model chooser sees before the next model call. */
export interface TurnContext {
  messages: Message[];
  totals: TokenTotals;
}

/**
 * Consulted after each recorded turn (same place as the turn-limit check). Return
 * "stop" to end the run gracefully — e.g. when a cost budget is exhausted.
 */
export type BudgetGate = (totals: TokenTotals) => "continue" | "stop";

/**
 * Optional per-turn model chooser. Return a model id to use for the next turn, or
 * undefined to keep `opts.model`. Lets the deterministic router (routing.ts) pick
 * a cheaper model for simple turns without the loop hard-coding any policy.
 */
export type SelectModelForTurn = (ctx: TurnContext) => string | undefined;

export interface AgentLoopOptions {
  system: string;
  tools: ToolDefinition[];
  callLlm: LlmCaller;
  executeTool: ToolExecutor;
  model?: string;
  maxTokens?: number;
  /** Hard cap on model turns, so a misbehaving model cannot loop forever. */
  maxTurns?: number;
  events?: AgentEvents;
  /** Token/cost account. If omitted, the loop keeps its own (observation only). */
  ledger?: TokenLedger;
  /** Optional cost brake. Absent = no budget gating (default). */
  budgetGate?: BudgetGate;
  /** Optional per-turn model routing. Absent = always use `opts.model` (default). */
  selectModelForTurn?: SelectModelForTurn;
  /**
   * No-progress guard: if the tools return the exact same error(s) this many
   * turns in a row, the agent is repairing in circles — stop honestly instead of
   * burning the rest of the turn/cost budget. Default 3 (two retries, then stop).
   */
  stallLimit?: number;
}

export interface AgentLoopResult {
  messages: Message[];
  finalText: string;
  turns: number;
  stopped: "end_turn" | "max_turns" | "budget" | "no_progress";
  /** Accumulated token usage and cost across the whole run. */
  usage: TokenTotals;
}

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_STALL_LIMIT = 3;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function collectText(content: ContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

/**
 * Drive a full tool-use conversation to completion.
 *
 * The loop is pure orchestration: it does not know what the tools do or how the
 * model is hosted. That makes it fully testable with a scripted caller and a
 * scripted executor, and keeps every side effect (VS Code, GitLab, network)
 * behind the two injected functions.
 *
 * Contract:
 * - It appends each assistant turn and each batch of tool results to `messages`.
 * - It stops when the model ends its turn without asking for a tool, or when it
 *   reaches `maxTurns` model calls (whichever comes first).
 * - A tool that throws is turned into an error tool_result and the loop
 *   continues, so the model can recover instead of the whole run crashing.
 */
export async function runAgentLoop(
  initialMessages: Message[],
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const stallLimit = opts.stallLimit ?? DEFAULT_STALL_LIMIT;
  const messages: Message[] = [...initialMessages];
  const ledger = opts.ledger ?? new TokenLedger();
  let turns = 0;
  let lastText = "";
  // No-progress detection: the error signature of the previous turn and how many
  // turns in a row it has repeated identically.
  let lastErrorSig = "";
  let stallCount = 0;

  while (true) {
    turns += 1;
    opts.events?.onTurn?.(turns);

    // Optional per-turn routing: the model may be cheaper for a simple turn.
    // Absent hook keeps the current behaviour (always opts.model).
    const model =
      opts.selectModelForTurn?.({ messages, totals: ledger.totals() }) ??
      opts.model;

    const response = await opts.callLlm({
      system: opts.system,
      tools: opts.tools,
      messages,
      model,
      max_tokens: opts.maxTokens,
    });

    // Record usage before anything else, so the budget gate below sees the cost
    // of the turn that just happened. Model id from the response, else the one
    // we asked for.
    if (response.usage) {
      ledger.record(response.usage, response.model ?? model ?? "unknown");
      opts.events?.onUsage?.(response.usage, ledger.totals());
    }

    const assistantContent = response.content ?? [];
    messages.push({ role: "assistant", content: assistantContent });

    const text = collectText(assistantContent);
    if (text) {
      lastText = text;
      opts.events?.onAssistantText?.(text);
    }

    const toolUses = assistantContent.filter(isToolUseBlock);
    const wantsTools = response.stop_reason === "tool_use" && toolUses.length > 0;

    if (!wantsTools) {
      return {
        messages,
        finalText: lastText,
        turns,
        stopped: "end_turn",
        usage: ledger.totals(),
      };
    }

    const overBudget = opts.budgetGate?.(ledger.totals()) === "stop";
    if (turns >= maxTurns || overBudget) {
      // Keep the transcript valid: every tool_use needs a paired tool_result,
      // even when we stop before executing. Otherwise a resumed conversation
      // would send a dangling tool_use to the model and get a 400.
      const why = overBudget
        ? "Abgebrochen: Kostenbudget erreicht, bevor dieses Werkzeug ausgeführt wurde."
        : "Abgebrochen: Rundenlimit erreicht, bevor dieses Werkzeug ausgeführt wurde.";
      const aborted: ToolResultBlock[] = toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: why,
        is_error: true,
      }));
      messages.push({ role: "user", content: aborted });
      return {
        messages,
        finalText: lastText,
        turns,
        stopped: overBudget ? "budget" : "max_turns",
        usage: ledger.totals(),
      };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const toolUse of toolUses) {
      opts.events?.onToolUse?.(toolUse);
      let result: ToolExecutionResult;
      try {
        result = await opts.executeTool(toolUse);
      } catch (e) {
        result = {
          content: `Werkzeug "${toolUse.name}" ist fehlgeschlagen: ${errorMessage(e)}`,
          isError: true,
        };
      }
      opts.events?.onToolResult?.(toolUse, result);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      });
    }

    messages.push({ role: "user", content: toolResults });

    // No-progress guard: if this turn's errors are identical to the last turn's,
    // the agent is stuck repairing the same thing. Reset on any progress (no
    // errors, or different errors). Stop honestly once it repeats stallLimit times.
    const errorSig = toolResults
      .filter((r) => r.is_error)
      .map((r) => r.content)
      .sort()
      .join(" ");
    if (errorSig && errorSig === lastErrorSig) {
      stallCount += 1;
    } else {
      lastErrorSig = errorSig;
      stallCount = errorSig ? 1 : 0;
    }
    if (errorSig && stallCount >= stallLimit) {
      return {
        messages,
        finalText: lastText,
        turns,
        stopped: "no_progress",
        usage: ledger.totals(),
      };
    }
  }
}

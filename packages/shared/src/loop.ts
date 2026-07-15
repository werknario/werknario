import {
  isTextBlock,
  isToolUseBlock,
  type ContentBlock,
  type LlmRequest,
  type LlmResponse,
  type Message,
  type ToolDefinition,
  type ToolResultBlock,
  type ToolUseBlock,
} from "./types.js";

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
}

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
}

export interface AgentLoopResult {
  messages: Message[];
  finalText: string;
  turns: number;
  stopped: "end_turn" | "max_turns";
}

const DEFAULT_MAX_TURNS = 12;

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
  const messages: Message[] = [...initialMessages];
  let turns = 0;
  let lastText = "";

  while (true) {
    turns += 1;
    opts.events?.onTurn?.(turns);

    const response = await opts.callLlm({
      system: opts.system,
      tools: opts.tools,
      messages,
      model: opts.model,
      max_tokens: opts.maxTokens,
    });

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
      return { messages, finalText: lastText, turns, stopped: "end_turn" };
    }

    if (turns >= maxTurns) {
      // Keep the transcript valid: every tool_use needs a paired tool_result,
      // even when we stop before executing. Otherwise a resumed conversation
      // would send a dangling tool_use to the model and get a 400.
      const aborted: ToolResultBlock[] = toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: "Abgebrochen: Rundenlimit erreicht, bevor dieses Werkzeug ausgeführt wurde.",
        is_error: true,
      }));
      messages.push({ role: "user", content: aborted });
      return { messages, finalText: lastText, turns, stopped: "max_turns" };
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
  }
}

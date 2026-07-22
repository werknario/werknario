/**
 * The CLI's agent run, decoupled from the terminal and the network so it can be
 * tested with fakes. It drives the same agent loop the extension uses, records
 * every step to the tamper-evident audit log, and returns whatever merge request
 * the agent opened so the caller can close the loop (merge/verify/rollback).
 */

import {
  AuditLog,
  makeSelectModelForTurn,
  runAgentLoop,
  createToolExecutor,
  TokenLedger,
  TOOL_DEFINITIONS,
  type LlmCaller,
  type RoutingPolicy,
  type TokenBudget,
  type TokenTotals,
  type ToolBackend,
} from "@werknario/shared";

export interface ApprovalRequest {
  tool: string;
  input: Record<string, unknown>;
}

export type RunEvent =
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string }
  | { type: "usage"; totals: TokenTotals }
  | { type: "info"; text: string };

export interface RunTaskDeps {
  backend: ToolBackend;
  caller: LlmCaller;
  system: string;
  /** Ask the human to confirm a team-visible write (merge request, comment). */
  approve: (req: ApprovalRequest) => Promise<boolean>;
  out: (event: RunEvent) => void;
  audit: AuditLog;
  /** Audit actor for the agent, e.g. "agent:hr-bot". */
  agentId: string;
  /** Audit actor for the human, e.g. "human:anna". */
  humanId: string;
  routing?: RoutingPolicy;
  budget?: TokenBudget;
  bedrockEu?: boolean;
  maxTurns?: number;
  /** Permission check on a path before the agent may stage an edit (from policy). */
  writeGuard?: (path: string) => { allowed: boolean; reason?: string };
}

export interface RunTaskResult {
  finalText: string;
  usage: TokenTotals;
  stopped: "end_turn" | "max_turns" | "budget";
  /** Set if the agent opened a merge request during the run. */
  mr?: { iid: number; webUrl: string; sourceBranch: string };
}

/**
 * Wrap the backend so every write is recorded to the audit log and the opened
 * merge request is captured. Reads are not audited (too noisy, no state change).
 */
function recordingBackend(
  backend: ToolBackend,
  audit: AuditLog,
  agentId: string,
  onMr: (mr: { iid: number; webUrl: string; sourceBranch: string }) => void,
): ToolBackend {
  return {
    listFiles: (p) => backend.listFiles(p),
    readFile: (p) => backend.readFile(p),
    async proposeEdit(path, content, summary) {
      const r = await backend.proposeEdit(path, content, summary);
      audit.append(agentId, "propose_edit", {
        path,
        isNew: r.isNew,
        summary,
        bytes: content.length,
      });
      return r;
    },
    async createMergeRequest(args) {
      const r = await backend.createMergeRequest(args);
      onMr({ iid: r.iid, webUrl: r.webUrl, sourceBranch: r.sourceBranch });
      audit.append(agentId, "create_merge_request", {
        iid: r.iid,
        title: args.title,
        sourceBranch: r.sourceBranch,
      });
      return r;
    },
    async addComment(args) {
      const r = await backend.addComment(args);
      audit.append(agentId, "add_comment", {
        targetType: args.targetType,
        iid: args.iid,
      });
      return r;
    },
  };
}

export async function runTask(
  task: string,
  deps: RunTaskDeps,
): Promise<RunTaskResult> {
  const { audit, humanId, agentId } = deps;
  audit.append(humanId, "task", { task });

  let mr: RunTaskResult["mr"];
  const backend = recordingBackend(deps.backend, audit, agentId, (m) => {
    mr = m;
  });

  const ledger = new TokenLedger({
    ...(deps.budget ? { budget: deps.budget } : {}),
    ...(deps.bedrockEu ? { bedrockEu: true } : {}),
  });

  const executor = createToolExecutor(backend, {
    onApprovalRequest: async (tu) => {
      const ok = await deps.approve({ tool: tu.name, input: tu.input ?? {} });
      audit.append(humanId, ok ? "approve" : "decline", { tool: tu.name });
      return ok;
    },
    ...(deps.writeGuard ? { writeGuard: deps.writeGuard } : {}),
  });

  const result = await runAgentLoop([{ role: "user", content: task }], {
    system: deps.system,
    tools: TOOL_DEFINITIONS,
    callLlm: deps.caller,
    executeTool: executor,
    ledger,
    ...(deps.maxTurns ? { maxTurns: deps.maxTurns } : {}),
    ...(deps.routing
      ? { selectModelForTurn: makeSelectModelForTurn(deps.routing) }
      : {}),
    ...(deps.budget
      ? {
          budgetGate: (totals: TokenTotals) =>
            totals.costUsd >= deps.budget!.maxUsd ? "stop" : "continue",
        }
      : {}),
    events: {
      onAssistantText: (text) => deps.out({ type: "assistant", text }),
      onToolUse: (b) => deps.out({ type: "tool", name: b.name }),
      onUsage: (_u, totals) => deps.out({ type: "usage", totals }),
    },
  });

  audit.append(agentId, "run_finished", {
    stopped: result.stopped,
    calls: result.usage.calls,
    costUsd: Number(result.usage.costUsd.toFixed(6)),
    tokens: result.usage.inputTokens + result.usage.outputTokens,
  });

  return {
    finalText: result.finalText,
    usage: result.usage,
    stopped: result.stopped,
    ...(mr ? { mr } : {}),
  };
}

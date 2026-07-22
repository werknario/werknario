import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AuditLog, type LlmResponse, type ToolBackend } from "@werknario/shared";
import { runTask, type RunEvent } from "../src/runTask.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function fixedClock() {
  let t = 0;
  return () => `2026-07-22T00:00:${String(t++).padStart(2, "0")}.000Z`;
}
function newAudit() {
  return new AuditLog({ hash: sha256, now: fixedClock() });
}

function fakeBackend(over: Partial<ToolBackend> = {}): ToolBackend {
  return {
    listFiles: vi.fn(async () => ["a.md"]),
    readFile: vi.fn(async () => "inhalt"),
    proposeEdit: vi.fn(async (path: string) => ({ path, isNew: true })),
    createMergeRequest: vi.fn(async (a) => ({
      webUrl: "http://host/mr/5",
      iid: 5,
      sourceBranch: a.sourceBranch,
    })),
    addComment: vi.fn(async () => ({})),
    ...over,
  };
}

function toolUse(name: string, input: Record<string, unknown>, id = "t"): LlmResponse {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
  };
}
function text(t: string): LlmResponse {
  return { role: "assistant", content: [{ type: "text", text: t }], stop_reason: "end_turn" };
}

function scriptedCaller(responses: LlmResponse[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("caller over-invoked");
    return r;
  });
}

const base = {
  system: "sys",
  agentId: "agent:hr-bot",
  humanId: "human:anna",
};

describe("runTask", () => {
  it("runs the loop, records an auditable chain, and returns the opened MR", async () => {
    const audit = newAudit();
    const out: RunEvent[] = [];
    const res = await runTask("Erstelle das Split-Sheet", {
      ...base,
      backend: fakeBackend(),
      caller: scriptedCaller([
        toolUse("read_file", { path: "a.md" }, "r"),
        toolUse("propose_edit", { path: "b.md", content: "hi", summary: "s" }, "p"),
        toolUse("create_merge_request", { title: "T", description: "D", source_branch: "x" }, "m"),
        text("Fertig."),
      ]),
      approve: async () => true,
      out: (e) => out.push(e),
      audit,
    });

    expect(res.mr).toEqual({ iid: 5, webUrl: "http://host/mr/5", sourceBranch: "x" });
    expect(res.finalText).toBe("Fertig.");

    const actions = audit.entries().map((e) => e.action);
    expect(actions).toEqual([
      "task",
      "propose_edit",
      "approve",
      "create_merge_request",
      "run_finished",
    ]);
    // the approval was recorded as the human's decision, the MR as the agent's action
    const approve = audit.entries().find((e) => e.action === "approve");
    expect(approve?.actor).toBe("human:anna");
    expect(audit.verify()).toEqual({ ok: true });
  });

  it("does not open an MR when the human declines, and records the decline", async () => {
    const audit = newAudit();
    const backend = fakeBackend();
    const res = await runTask("mach was", {
      ...base,
      backend,
      caller: scriptedCaller([
        toolUse("create_merge_request", { title: "T", description: "D", source_branch: "x" }, "m"),
        text("Ok, nicht geöffnet."),
      ]),
      approve: async () => false,
      out: () => {},
      audit,
    });

    expect(res.mr).toBeUndefined();
    expect(backend.createMergeRequest).not.toHaveBeenCalled();
    expect(audit.entries().map((e) => e.action)).toContain("decline");
    expect(audit.verify()).toEqual({ ok: true });
  });
});

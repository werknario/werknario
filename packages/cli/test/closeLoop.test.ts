import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AuditLog } from "@werknario/shared";
import { closeLoop, rollback, type MergeGateway } from "../src/closeLoop.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function fixedClock() {
  let t = 0;
  return () => `2026-07-22T00:00:${String(t++).padStart(2, "0")}.000Z`;
}
const newAudit = () => new AuditLog({ hash: sha256, now: fixedClock() });

function fakeGateway(over: Partial<MergeGateway> = {}): MergeGateway {
  return {
    checkMergeable: vi.fn(async () => ({ mergeable: true })),
    merge: vi.fn(async () => ({ sha: "abc123" })),
    revert: vi.fn(async () => ({ branch: "revert/mr-5", webUrl: "http://host/mr/9" })),
    ...over,
  };
}

const base = { humanId: "human:anna", agentId: "agent:hr-bot", out: () => {} };

describe("closeLoop", () => {
  it("merges after a mergeable check and human approval, fully audited", async () => {
    const audit = newAudit();
    const gateway = fakeGateway();
    const r = await closeLoop(5, {
      ...base,
      gateway,
      approveMerge: async () => true,
      audit,
    });
    expect(r).toEqual({ merged: true, sha: "abc123" });
    expect(gateway.merge).toHaveBeenCalledWith(5);
    expect(audit.entries().map((e) => e.action)).toEqual([
      "mergeable_check",
      "approve_merge",
      "merge",
    ]);
    expect(audit.verify()).toEqual({ ok: true });
  });

  it("blocks the merge when the human is not an authorised approver", async () => {
    const audit = newAudit();
    const approveMerge = vi.fn(async () => true);
    const gateway = fakeGateway();
    const r = await closeLoop(5, {
      ...base, // humanId: human:anna
      gateway,
      approveMerge,
      audit,
      policy: { approvers: { "vertraege/**": ["chef"] } },
      touchedPaths: ["vertraege/split.md"],
    });
    expect(r).toEqual({
      merged: false,
      reason: "not_authorized",
      detail: "vertraege/split.md",
    });
    expect(approveMerge).not.toHaveBeenCalled();
    expect(gateway.merge).not.toHaveBeenCalled();
    expect(audit.entries().map((e) => e.action)).toEqual([
      "mergeable_check",
      "merge_denied",
    ]);
    expect(audit.verify()).toEqual({ ok: true });
  });

  it("lets an authorised approver merge", async () => {
    const audit = newAudit();
    const gateway = fakeGateway();
    const r = await closeLoop(5, {
      ...base, // human:anna
      gateway,
      approveMerge: async () => true,
      audit,
      policy: { approvers: { "vertraege/**": ["anna"] } },
      touchedPaths: ["vertraege/split.md"],
    });
    expect(r).toEqual({ merged: true, sha: "abc123" });
  });

  it("refuses to merge on a conflict and never asks for approval", async () => {
    const audit = newAudit();
    const approveMerge = vi.fn(async () => true);
    const gateway = fakeGateway({
      checkMergeable: vi.fn(async () => ({ mergeable: false, reason: "conflict" })),
    });
    const r = await closeLoop(5, { ...base, gateway, approveMerge, audit });
    expect(r).toEqual({ merged: false, reason: "conflict", detail: "conflict" });
    expect(approveMerge).not.toHaveBeenCalled();
    expect(gateway.merge).not.toHaveBeenCalled();
  });

  it("stops before merging when verification fails", async () => {
    const audit = newAudit();
    const gateway = fakeGateway();
    const r = await closeLoop(5, {
      ...base,
      gateway,
      approveMerge: async () => true,
      verify: async () => ({ ok: false, detail: "CI red" }),
      audit,
    });
    expect(r.merged).toBe(false);
    expect((r as { reason: string }).reason).toBe("verify_failed");
    expect(gateway.merge).not.toHaveBeenCalled();
    expect(audit.entries().map((e) => e.action)).toContain("verify");
  });

  it("records a decline_merge and does not merge", async () => {
    const audit = newAudit();
    const gateway = fakeGateway();
    const r = await closeLoop(5, {
      ...base,
      gateway,
      approveMerge: async () => false,
      audit,
    });
    expect(r).toEqual({ merged: false, reason: "declined" });
    expect(gateway.merge).not.toHaveBeenCalled();
    expect(audit.entries().map((e) => e.action)).toContain("decline_merge");
  });

  it("rollback proposes a revert and records it", async () => {
    const audit = newAudit();
    const gateway = fakeGateway();
    const r = await rollback(5, "abc123", { gateway, audit, humanId: "human:anna", out: () => {} });
    expect(r.branch).toBe("revert/mr-5");
    expect(audit.entries().map((e) => e.action)).toContain("rollback");
  });
});

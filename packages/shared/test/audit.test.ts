import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AuditLog } from "../src/index.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function fixedClock() {
  let t = 0;
  return () => `2026-07-22T00:00:${String(t++).padStart(2, "0")}.000Z`;
}

function newLog() {
  return new AuditLog({ hash: sha256, now: fixedClock() });
}

describe("AuditLog — tamper-evident hash chain", () => {
  it("links each entry to the previous by hash", () => {
    const log = newLog();
    const a = log.append("agent:hr-bot", "propose_edit", { path: "a.md" });
    const b = log.append("human:anna", "approve", { mr: 1 });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(b.prevHash).toBe(a.hash);
    expect(a.hash).not.toBe(b.hash);
  });

  it("produces a deterministic hash regardless of detail key order", () => {
    const l1 = new AuditLog({ hash: sha256, now: fixedClock() });
    const l2 = new AuditLog({ hash: sha256, now: fixedClock() });
    const e1 = l1.append("agent:x", "merge", { mr: 7, branch: "split/x" });
    const e2 = l2.append("agent:x", "merge", { branch: "split/x", mr: 7 });
    expect(e1.hash).toBe(e2.hash);
  });

  it("verifies an untampered log", () => {
    const log = newLog();
    log.append("agent:x", "propose_edit", { path: "a.md" });
    log.append("human:anna", "approve", { mr: 1 });
    log.append("agent:x", "merge", { mr: 1 });
    expect(log.verify()).toEqual({ ok: true });
  });

  it("detects a tampered detail field", () => {
    const log = newLog();
    log.append("agent:x", "propose_edit", { path: "a.md" });
    log.append("human:anna", "approve", { mr: 1, amount: "12,5%" });
    log.append("agent:x", "merge", { mr: 1 });
    // Someone edits the approved amount after the fact.
    const raw = log.toJsonl().split("\n");
    const tampered = raw.map((line, i) =>
      i === 1 ? line.replace("12,5%", "50%") : line,
    );
    const loaded = AuditLog.load(tampered.join("\n"), {
      hash: sha256,
      now: fixedClock(),
    });
    const v = loaded.verify();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("detects a deleted entry", () => {
    const log = newLog();
    log.append("agent:x", "propose_edit", { path: "a.md" });
    log.append("human:anna", "approve", { mr: 1 });
    log.append("agent:x", "merge", { mr: 1 });
    const raw = log.toJsonl().split("\n");
    raw.splice(1, 1); // drop the approval
    const loaded = AuditLog.load(raw.join("\n"), {
      hash: sha256,
      now: fixedClock(),
    });
    expect(loaded.verify().ok).toBe(false);
  });

  it("round-trips a detail with an undefined value and still verifies (JSON drops it)", () => {
    const log = newLog();
    // e.g. a mergeable_check with no reason: { iid: 1, mergeable: true, reason: undefined }
    log.append("system", "mergeable_check", { iid: 1, mergeable: true, reason: undefined });
    log.append("agent:x", "merge", { iid: 1 });
    const loaded = AuditLog.load(log.toJsonl(), { hash: sha256, now: fixedClock() });
    expect(loaded.verify()).toEqual({ ok: true });
  });

  it("round-trips through JSONL and keeps verifying", () => {
    const log = newLog();
    log.append("agent:x", "propose_edit", { path: "a.md" });
    log.append("human:anna", "approve", { mr: 1 });
    const jsonl = log.toJsonl();
    const loaded = AuditLog.load(jsonl, { hash: sha256, now: fixedClock() });
    expect(loaded.verify()).toEqual({ ok: true });
    expect(loaded.entries()).toHaveLength(2);
  });

  it("calls onAppend for every entry so a caller can persist it durably", () => {
    const written: string[] = [];
    const log = new AuditLog({
      hash: sha256,
      now: fixedClock(),
      onAppend: (e) => written.push(e.action),
    });
    log.append("agent:x", "propose_edit", {});
    log.append("human:anna", "approve", {});
    expect(written).toEqual(["propose_edit", "approve"]);
  });

  it("refuses a non-JSON-plain detail instead of silently collapsing it to {}", () => {
    const log = newLog();
    expect(() =>
      log.append("agent:x", "merge", { when: new Date("2020-01-01") }),
    ).toThrow(/JSON-plain/);
  });

  it("continues the chain when appending to a loaded log", () => {
    const log = newLog();
    log.append("agent:x", "propose_edit", { path: "a.md" });
    const loaded = AuditLog.load(log.toJsonl(), {
      hash: sha256,
      now: fixedClock(),
    });
    const next = loaded.append("human:anna", "approve", { mr: 1 });
    expect(next.seq).toBe(1);
    expect(next.prevHash).toBe(loaded.entries()[0]?.hash);
    expect(loaded.verify()).toEqual({ ok: true });
  });
});

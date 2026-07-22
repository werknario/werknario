import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AuditLog } from "@werknario/shared";
import { verifyAuditText } from "../src/verifyCommand.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function fixedClock() {
  let t = 0;
  return () => `2026-07-22T00:00:${String(t++).padStart(2, "0")}.000Z`;
}

function sampleLog(genesis = "org/repo"): string {
  const log = new AuditLog({ hash: sha256, now: fixedClock(), genesisHash: genesis });
  log.append("human:anna", "task", { task: "x" });
  log.append("agent:x", "propose_edit", { path: "a.md" });
  log.append("agent:x", "merge", { iid: 1 });
  return log.toJsonl();
}

describe("verifyAuditText", () => {
  it("verifies an intact chain, reading the genesis from the file", () => {
    const r = verifyAuditText(sampleLog());
    expect(r.ok).toBe(true);
    expect(r.entries).toBe(3);
    expect(r.genesisUsed).toBe("org/repo");
  });

  it("verifies against an explicit genesis when given", () => {
    expect(verifyAuditText(sampleLog("org/repo"), "org/repo").ok).toBe(true);
  });

  it("fails against the wrong explicit genesis (repo mismatch)", () => {
    const r = verifyAuditText(sampleLog("org/repo"), "other/repo");
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(0);
  });

  it("detects a tampered entry", () => {
    const lines = sampleLog().split("\n");
    lines[1] = lines[1]!.replace("a.md", "b.md");
    const r = verifyAuditText(lines.join("\n"));
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
  });

  it("reports a parse error instead of throwing", () => {
    const r = verifyAuditText("{not json\n");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/parse/);
  });

  it("treats an empty file as an empty, valid chain", () => {
    expect(verifyAuditText("")).toMatchObject({ ok: true, entries: 0 });
  });
});

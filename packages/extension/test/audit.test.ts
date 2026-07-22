import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeEntry, type AuditEntry } from "@werknario/shared";
import { ExtensionAuditLog, sha256Hex, type AuditMemento } from "../src/audit.js";

/** node:crypto sha256, used only to prove the browser (Web Crypto) hash matches
 * what the CLI (and `werknario verify`) computes for the same input. */
const nodeSha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Map-backed fake for vscode.Memento — enough of the surface for AuditMemento. */
function fakeMemento(): AuditMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
  };
}

describe("sha256Hex", () => {
  it("matches the NIST test vector for 'abc'", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the NIST test vector for the empty string", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches node:crypto's sha256 for a range of inputs", async () => {
    const inputs = [
      "abc",
      "",
      "werknario",
      "a".repeat(1000),
      JSON.stringify({ a: 1, b: [1, 2, 3], c: "ümlaut & \"quote\"" }),
      "line one\nline two\ttab",
    ];
    for (const input of inputs) {
      await expect(sha256Hex(input)).resolves.toBe(nodeSha256(input));
    }
  });

  it("matches node:crypto's sha256 of canonicalizeEntry(sampleEntry) — the exact string the CLI hashes", async () => {
    const sampleEntry: Omit<AuditEntry, "hash"> = {
      seq: 0,
      ts: "2026-07-22T10:00:00.000Z",
      actor: "human:you",
      action: "task",
      detail: { task: "Öffne einen Merge Request für die Vertragsänderung." },
      prevHash: "x/fleetlicht-demo",
    };
    const canonical = canonicalizeEntry(sampleEntry);
    await expect(sha256Hex(canonical)).resolves.toBe(nodeSha256(canonical));
  });
});

describe("ExtensionAuditLog", () => {
  it("builds a linked chain: each entry's prevHash is the previous entry's hash", async () => {
    const memento = fakeMemento();
    const log = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");

    const entry0 = await log.append("human:you", "task", { task: "hi" });
    const entry1 = await log.append("agent:webide", "create_merge_request", {
      title: "Split Sheet",
    });

    expect(entry0.seq).toBe(0);
    expect(entry0.prevHash).toBe("x/fleetlicht-demo");
    expect(entry1.seq).toBe(1);
    expect(entry1.prevHash).toBe(entry0.hash);
    expect(log.lastHash).toBe(entry1.hash);
    expect(log.entries()).toHaveLength(2);
  });

  it("persists entries to workspaceState under a genesis-namespaced key", async () => {
    const memento = fakeMemento();
    const log = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");
    await log.append("human:you", "task", { task: "hi" });

    const reloaded = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");
    expect(reloaded.entries()).toHaveLength(1);
    expect(reloaded.entries()[0]?.action).toBe("task");
  });

  it("keeps separate chains for different genesis (project) keys", async () => {
    const memento = fakeMemento();
    const logA = ExtensionAuditLog.load(memento, "x/project-a");
    const logB = ExtensionAuditLog.load(memento, "x/project-b");
    await logA.append("human:you", "task", { task: "a" });

    expect(logA.entries()).toHaveLength(1);
    expect(logB.entries()).toHaveLength(0);
  });

  it("verify() reports ok for an untampered chain", async () => {
    const memento = fakeMemento();
    const log = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");
    await log.append("human:you", "task", { task: "hi" });
    await log.append("agent:webide", "create_merge_request", { title: "t" });
    await log.append("human:you", "approve", { tool: "create_merge_request" });

    await expect(log.verify()).resolves.toEqual({ ok: true });
  });

  it("verify() reports ok for an empty chain", async () => {
    const log = ExtensionAuditLog.load(fakeMemento(), "x/fleetlicht-demo");
    await expect(log.verify()).resolves.toEqual({ ok: true });
  });

  it("verify() detects a tampered entry (detail edited after the fact)", async () => {
    const memento = fakeMemento();
    const log = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");
    await log.append("human:you", "task", { task: "hi" });
    await log.append("agent:webide", "create_merge_request", { title: "t" });

    const tampered = log.entries();
    const second = tampered[1];
    if (!second) throw new Error("expected a second entry");
    second.detail = { title: "TAMPERED" };
    const reloaded = ExtensionAuditLog.load(
      { get: () => tampered, update: async () => undefined },
      "x/fleetlicht-demo",
    );

    const result = await reloaded.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toMatch(/modified after/);
  });

  it("verify() detects a broken prevHash link (entry removed from the middle)", async () => {
    const memento = fakeMemento();
    const log = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");
    await log.append("human:you", "task", { task: "hi" });
    await log.append("agent:webide", "create_merge_request", { title: "t" });
    await log.append("human:you", "approve", { tool: "create_merge_request" });

    const withGap = [log.entries()[0], log.entries()[2]] as AuditEntry[];
    const reloaded = ExtensionAuditLog.load(
      { get: () => withGap, update: async () => undefined },
      "x/fleetlicht-demo",
    );

    const result = await reloaded.verify();
    expect(result.ok).toBe(false);
    // The gap surfaces as either a seq mismatch or a prevHash mismatch,
    // depending on which check runs first — both correctly flag entry 1.
    expect(result.brokenAt).toBe(1);
  });

  it("a chain built here verifies against a plain node:crypto sha256 (CLI-side) recomputation — proves CLI/verify acceptance", async () => {
    const memento = fakeMemento();
    const log = ExtensionAuditLog.load(memento, "x/fleetlicht-demo");
    await log.append("human:you", "task", { task: "hi" });
    await log.append("agent:webide", "create_merge_request", { title: "t" });

    let prev = "x/fleetlicht-demo";
    for (const entry of log.entries()) {
      const recomputed = nodeSha256(
        canonicalizeEntry({
          seq: entry.seq,
          ts: entry.ts,
          actor: entry.actor,
          action: entry.action,
          detail: entry.detail,
          prevHash: entry.prevHash,
        }),
      );
      expect(entry.prevHash).toBe(prev);
      expect(recomputed).toBe(entry.hash);
      prev = entry.hash;
    }
  });
});

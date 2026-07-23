import { describe, expect, it } from "vitest";
import { SIGNATURE_ACTION, signatureDetail, verifySignatures } from "../src/index.js";

// A toy verifier: a signature is "sig-of:<data>". Lets us test the chain logic
// without real crypto (the real Ed25519 verify is exercised in the CLI tests).
const toyVerify = (data: string, sig: string) => sig === `sig-of:${data}`;

function entry(
  seq: number,
  action: string,
  hash: string,
  detail?: unknown,
): { seq: number; action: string; hash: string; detail?: unknown } {
  return { seq, action, hash, ...(detail !== undefined ? { detail } : {}) };
}

describe("verifySignatures", () => {
  it("passes when a checkpoint signs the previous entry's hash", () => {
    const entries = [
      entry(0, "task", "h0"),
      entry(1, "merge", "h1"),
      entry(2, SIGNATURE_ACTION, "h2", signatureDetail("h1", "sig-of:h1", "kA")),
    ];
    const r = verifySignatures(entries, toyVerify);
    expect(r).toEqual({ ok: true, checked: 1 });
  });

  it("is ok with zero checkpoints (nothing signed is not a bad signature)", () => {
    const r = verifySignatures([entry(0, "task", "h0")], toyVerify);
    expect(r).toEqual({ ok: true, checked: 0 });
  });

  it("fails when the signed head does not match the previous entry", () => {
    const entries = [
      entry(0, "merge", "h0"),
      entry(1, SIGNATURE_ACTION, "h1", signatureDetail("WRONG", "sig-of:WRONG")),
    ];
    const r = verifySignatures(entries, toyVerify);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/head does not match/);
  });

  it("fails when the signature does not verify for the key", () => {
    const entries = [
      entry(0, "merge", "h0"),
      entry(1, SIGNATURE_ACTION, "h1", signatureDetail("h0", "sig-of:tampered")),
    ];
    const r = verifySignatures(entries, toyVerify);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not verify/);
  });

  it("fails on a malformed signature detail", () => {
    const entries = [
      entry(0, "merge", "h0"),
      entry(1, SIGNATURE_ACTION, "h1", { alg: "rsa" }),
    ];
    expect(verifySignatures(entries, toyVerify).ok).toBe(false);
  });

  it("verifies several checkpoints across a log", () => {
    const entries = [
      entry(0, "merge", "h0"),
      entry(1, SIGNATURE_ACTION, "h1", signatureDetail("h0", "sig-of:h0")),
      entry(2, "merge", "h2"),
      entry(3, SIGNATURE_ACTION, "h3", signatureDetail("h2", "sig-of:h2")),
    ];
    expect(verifySignatures(entries, toyVerify)).toEqual({ ok: true, checked: 2 });
  });
});

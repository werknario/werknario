import { describe, expect, it } from "vitest";
import {
  generateKeypair,
  keyIdFromPrivatePem,
  keyIdFromPublicPem,
  makeVerifier,
  signData,
} from "../src/signing.js";

describe("Ed25519 signing round-trip", () => {
  it("signs and verifies data with a generated keypair", () => {
    const { privatePem, publicPem, keyId } = generateKeypair();
    const sig = signData("chainhead-abc", privatePem);
    const verify = makeVerifier(publicPem);
    expect(verify("chainhead-abc", sig)).toBe(true);
    expect(verify("tampered", sig)).toBe(false);
    expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(keyIdFromPrivatePem(privatePem)).toBe(keyIdFromPublicPem(publicPem));
  });

  it("a signature from one key does not verify under another", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const sig = signData("x", a.privatePem);
    expect(makeVerifier(b.publicPem)("x", sig)).toBe(false);
  });

  it("rejects a garbage signature without throwing", () => {
    const { publicPem } = generateKeypair();
    expect(makeVerifier(publicPem)("x", "!!!not-base64!!!")).toBe(false);
  });
});

/**
 * Ed25519 signing for the audit log, using node's built-in crypto — no external
 * key service, no transparency log, nothing leaves the machine. The operator
 * holds the private key; anyone with the public key can verify that the log was
 * signed by that key holder. The pure chain logic lives in
 * `@werknario/shared` (signing.ts); this file is only the node crypto.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";
import type { SignatureVerifier } from "@werknario/shared";

export interface Keypair {
  privatePem: string;
  publicPem: string;
  keyId: string;
}

/** A short, stable fingerprint of a public key (first 16 hex of its SPKI sha256). */
export function keyIdFromPublicPem(publicPem: string): string {
  const der = createPublicKey(publicPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export function keyIdFromPrivatePem(privatePem: string): string {
  const pub = createPublicKey(createPrivateKey(privatePem));
  const der = pub.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { privatePem, publicPem, keyId: keyIdFromPublicPem(publicPem) };
}

/** Sign `data` with an Ed25519 private key (PEM); returns a base64 signature. */
export function signData(data: string, privatePem: string): string {
  const key = createPrivateKey(privatePem);
  return edSign(null, Buffer.from(data), key).toString("base64");
}

/** Build a verifier bound to an Ed25519 public key (PEM). Never throws. */
export function makeVerifier(publicPem: string): SignatureVerifier {
  const key = createPublicKey(publicPem);
  return (data: string, sigBase64: string): boolean => {
    try {
      return edVerify(null, Buffer.from(data), key, Buffer.from(sigBase64, "base64"));
    } catch {
      return false;
    }
  };
}

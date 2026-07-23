/**
 * Signed audit checkpoints. The hash chain (audit.ts) is tamper-evident: it
 * proves the log was not edited after the fact. It does not prove WHO produced
 * it — anyone who can append could recompute a valid chain. A signature closes
 * that gap: a checkpoint entry carries an Ed25519 signature over the chain head
 * at that moment, produced by a key the operator holds. Verifying it with the
 * matching public key attests that the holder of the private key stood behind
 * the log up to that point (non-repudiation), without any external service.
 *
 * This module is pure and crypto-agnostic: the signing and verifying are
 * injected (node's Ed25519 in the CLI), so it runs anywhere the hash chain does.
 * The heavier keyless route (Sigstore/Fulcio + a self-hosted Rekor transparency
 * log) is the later option; this is the self-hostable, EU-resident first step.
 */

export const SIGNATURE_ACTION = "signature";

// A type alias (not an interface) so it carries an implicit index signature and
// stays assignable to the audit log's Record<string, unknown> detail parameter.
export type SignatureDetail = {
  alg: "ed25519";
  /** The chain head (hash of the entry immediately before this one) that is signed. */
  head: string;
  /** Base64 Ed25519 signature over `head`. */
  sig: string;
  /** Short fingerprint of the public key, so a verifier can tell which key to use. */
  keyId?: string;
};

/** Builds the detail object for a signature checkpoint entry. */
export function signatureDetail(
  head: string,
  sig: string,
  keyId?: string,
): SignatureDetail {
  return { alg: "ed25519", head, sig, ...(keyId ? { keyId } : {}) };
}

/** Returns true if `sigBase64` verifies over `data` for a trusted public key. */
export type SignatureVerifier = (data: string, sigBase64: string) => boolean;

export interface SignatureCheck {
  ok: boolean;
  /** How many signature checkpoints were verified. */
  checked: number;
  reason?: string;
}

interface MinimalEntry {
  seq: number;
  action: string;
  detail?: unknown;
  hash: string;
}

function isSignatureDetail(d: unknown): d is SignatureDetail {
  if (typeof d !== "object" || d === null) return false;
  const r = d as Record<string, unknown>;
  return (
    r["alg"] === "ed25519" &&
    typeof r["head"] === "string" &&
    typeof r["sig"] === "string"
  );
}

/**
 * Verify every signature checkpoint in an audit log. Each one must (1) sign the
 * hash of the entry immediately before it — the chain head at that point — and
 * (2) verify for the trusted public key. Returns the first failure, or ok with a
 * count. A log with no signature entries is ok with checked = 0 (nothing signed
 * is not the same as a bad signature; the caller decides whether that is enough).
 */
export function verifySignatures(
  entries: MinimalEntry[],
  verify: SignatureVerifier,
): SignatureCheck {
  let checked = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.action !== SIGNATURE_ACTION) continue;
    if (!isSignatureDetail(e.detail)) {
      return { ok: false, checked, reason: `entry ${e.seq}: malformed signature` };
    }
    const prev = entries[i - 1];
    if (!prev || prev.hash !== e.detail.head) {
      return {
        ok: false,
        checked,
        reason: `entry ${e.seq}: signed head does not match the previous entry`,
      };
    }
    if (!verify(e.detail.head, e.detail.sig)) {
      return {
        ok: false,
        checked,
        reason: `entry ${e.seq}: signature does not verify for the given key`,
      };
    }
    checked++;
  }
  return { ok: true, checked };
}

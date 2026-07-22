/**
 * `werknario verify <audit.jsonl>`: check an audit log on its own, without a
 * whole agent run, so an auditor or a CI job can confirm a chain is intact and
 * exit non-zero if it is not.
 *
 * The genesis seed can be given with --genesis (the repository path the log was
 * created for — the strict check, which also catches a rewritten first entry).
 * Without it, the genesis is read from the file's own first entry, which still
 * catches partial tampering in the middle of the chain.
 */

import { AuditLog, type AuditEntry } from "@werknario/shared";
import { sha256 } from "./auditStore.js";

export interface VerifyOutcome {
  ok: boolean;
  entries: number;
  brokenAt?: number;
  reason?: string;
  genesisUsed: string;
}

export function verifyAuditText(
  jsonl: string,
  genesisOverride?: string,
): VerifyOutcome {
  let genesis = genesisOverride;
  try {
    if (genesis === undefined) {
      const firstLine = jsonl
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (firstLine) {
        const first = JSON.parse(firstLine) as AuditEntry;
        if (typeof first.prevHash === "string") genesis = first.prevHash;
      }
    }
    const log = AuditLog.load(jsonl, {
      hash: sha256,
      now: () => "",
      ...(genesis !== undefined ? { genesisHash: genesis } : {}),
    });
    const v = log.verify();
    return {
      ok: v.ok,
      entries: log.entries().length,
      ...(v.brokenAt !== undefined ? { brokenAt: v.brokenAt } : {}),
      ...(v.reason !== undefined ? { reason: v.reason } : {}),
      genesisUsed: genesis ?? "(default)",
    };
  } catch (e) {
    return {
      ok: false,
      entries: 0,
      reason: `could not parse the audit file: ${e instanceof Error ? e.message : String(e)}`,
      genesisUsed: genesis ?? "(default)",
    };
  }
}

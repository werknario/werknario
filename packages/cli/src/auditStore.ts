/**
 * Persist the audit chain to a file (default .werknario/audit.jsonl) durably:
 * each entry is appended to disk the instant it is recorded, via the AuditLog's
 * onAppend hook. A crash mid-run therefore keeps every completed action on
 * record, rather than losing the whole run's trail. Uses a real sha256; on open
 * it verifies the existing chain and refuses to continue a tampered log.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { AuditLog, type AuditEntry } from "@werknario/shared";

export const sha256 = (s: string) =>
  createHash("sha256").update(s).digest("hex");

const clock = () => new Date().toISOString();

/**
 * Open (or create) the audit log at `path`. Existing entries are loaded and
 * verified; new entries are appended to the file immediately as they are made.
 */
export function openAuditLog(path: string, genesisHash: string): AuditLog {
  mkdirSync(dirname(path), { recursive: true });
  const onAppend = (entry: AuditEntry) =>
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  const opts = { hash: sha256, now: clock, genesisHash, onAppend };

  if (existsSync(path)) {
    const log = AuditLog.load(readFileSync(path, "utf8"), opts);
    const v = log.verify();
    if (!v.ok) {
      throw new Error(
        `The existing audit log at ${path} does not verify (entry ${v.brokenAt}: ${v.reason}). ` +
          "It was changed outside this tool. Refusing to append to a tampered chain.",
      );
    }
    return log;
  }
  return new AuditLog(opts);
}

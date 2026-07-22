/**
 * Tamper-evident audit log for the Web IDE extension (browser Web Worker host,
 * no node:crypto, no node:fs). Same hash-chain shape as the CLI's AuditLog
 * (@werknario/shared audit.ts): each entry carries the hash of the one before
 * it, so an edited, reordered or deleted entry breaks verification.
 *
 * Two differences from the CLI's AuditLog, both dictated by the runtime:
 * - Hashing goes through the async Web Crypto API (crypto.subtle.digest)
 *   instead of node:crypto. canonicalizeEntry is imported from
 *   @werknario/shared so the exact same string gets hashed on both sides —
 *   that is what lets a chain started here be accepted by `werknario verify`.
 * - Persistence is VS Code's workspaceState (a Memento), keyed by genesis, not
 *   a JSONL file — there is no filesystem to write into in this host.
 */

import { canonicalizeEntry, type AuditEntry } from "@werknario/shared";

/** The slice of vscode.Memento this module needs. A real ExtensionContext's
 * workspaceState satisfies this structurally; tests use a Map-backed fake. */
export interface AuditMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface AuditVerifyResult {
  ok: boolean;
  /** seq of the first entry that fails, if any. */
  brokenAt?: number;
  reason?: string;
}

const KEY_PREFIX = "werknario.audit.";

function storageKey(genesis: string): string {
  return `${KEY_PREFIX}${genesis}`;
}

/** sha256 via the async Web Crypto API, hex-encoded. Must match node:crypto's
 * sha256 byte for byte — the CLI and `werknario verify` recompute this same
 * chain with node:crypto, so this is what gives the extension's log CLI parity. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Async counterpart to the CLI's AuditLog, backed by workspaceState instead of
 * a file. Genesis (the seed for the first entry's prevHash) is the GitLab
 * project path, so the chain is bound to the project it was recorded for —
 * same convention the CLI uses (see packages/cli/src/cli.ts).
 */
export class ExtensionAuditLog {
  private constructor(
    private readonly memento: AuditMemento,
    private readonly genesis: string,
    private _entries: AuditEntry[],
  ) {}

  /** Load whatever entries already exist for this project from workspaceState.
   * Nothing is written until the first append(). */
  static load(memento: AuditMemento, genesis: string): ExtensionAuditLog {
    const existing = memento.get<AuditEntry[]>(storageKey(genesis)) ?? [];
    return new ExtensionAuditLog(memento, genesis, [...existing]);
  }

  /** The hash the next entry will chain from. */
  get lastHash(): string {
    const last = this._entries[this._entries.length - 1];
    return last ? last.hash : this.genesis;
  }

  entries(): AuditEntry[] {
    return [...this._entries];
  }

  /** Append one entry, persist the full chain to workspaceState, and return it. */
  async append(
    actor: string,
    action: string,
    detail: Record<string, unknown> = {},
  ): Promise<AuditEntry> {
    const base: Omit<AuditEntry, "hash"> = {
      seq: this._entries.length,
      ts: new Date().toISOString(),
      actor,
      action,
      detail,
      prevHash: this.lastHash,
    };
    const hash = await sha256Hex(canonicalizeEntry(base));
    const entry: AuditEntry = { ...base, hash };
    this._entries.push(entry);
    await this.memento.update(storageKey(this.genesis), this._entries);
    return entry;
  }

  /**
   * Recompute the whole chain and report the first entry that does not hold
   * up: a wrong seq, a broken prevHash link, or a hash that does not match the
   * entry's own fields. Same rules as the CLI's AuditLog.verify, async because
   * the hash function is.
   */
  async verify(): Promise<AuditVerifyResult> {
    let prev = this.genesis;
    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      if (!e) return { ok: false, brokenAt: i, reason: "missing entry" };
      if (e.seq !== i) {
        return { ok: false, brokenAt: i, reason: "seq out of order" };
      }
      if (e.prevHash !== prev) {
        return {
          ok: false,
          brokenAt: i,
          reason: "prevHash does not match previous entry",
        };
      }
      const recomputed = await sha256Hex(
        canonicalizeEntry({
          seq: e.seq,
          ts: e.ts,
          actor: e.actor,
          action: e.action,
          detail: e.detail,
          prevHash: e.prevHash,
        }),
      );
      if (recomputed !== e.hash) {
        return {
          ok: false,
          brokenAt: i,
          reason: "entry was modified after it was written",
        };
      }
      prev = e.hash;
    }
    return { ok: true };
  }
}

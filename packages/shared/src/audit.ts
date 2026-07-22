/**
 * Tamper-evident audit log. This is the trust anchor of the whole idea: every
 * agent action and every human decision is one entry in a hash chain, where each
 * entry carries the hash of the one before it. Change, delete, reorder or insert
 * an entry after the fact and the chain no longer verifies. That is what makes
 * "an agent changed this document, a human approved it" checkable rather than a
 * claim.
 *
 * The hash function is injected, so this module stays portable (no node:crypto
 * import — it runs in the browser extension too). In Node, pass a real sha256
 * (see the CLI). Tests pass node:crypto's sha256. The clock is injected too, so
 * the log is deterministic under test.
 */

export interface AuditEntry {
  /** 0-based position in the chain. */
  seq: number;
  /** ISO timestamp, from the injected clock. */
  ts: string;
  /** Who acted: "agent:<id>", "human:<name>", or "system". */
  actor: string;
  /** What happened: propose_edit, approve, create_merge_request, merge, verify, rollback, comment, ... */
  action: string;
  /** Structured payload (path, branch, mr, model, cost, verdict, ...). */
  detail: Record<string, unknown>;
  /** Hash of the previous entry (or the genesis seed for the first). */
  prevHash: string;
  /** Hash over this entry's fields plus prevHash. */
  hash: string;
}

export interface AuditLogOptions {
  /** Cryptographic hash, hex string out. Injected to keep this module portable. */
  hash: (input: string) => string;
  /** Returns the current time as an ISO string. Injected for deterministic tests. */
  now: () => string;
  /** Seed for the first entry's prevHash. Use a repo-specific value to bind the chain. */
  genesisHash?: string;
  /** Existing entries to continue from (from AuditLog.load). */
  initial?: AuditEntry[];
  /**
   * Called synchronously right after each new entry is appended. The CLI writes
   * the entry to disk here, so a crash mid-run still leaves every completed
   * action on record instead of losing the whole run's trail.
   */
  onAppend?: (entry: AuditEntry) => void;
}

export interface VerifyResult {
  ok: boolean;
  /** seq of the first entry that fails, if any. */
  brokenAt?: number;
  reason?: string;
}

const DEFAULT_GENESIS = "werknario-audit-genesis";

/**
 * Deterministic JSON: object keys sorted recursively, so key order can't change
 * the hash. Fails loud on values that are not JSON-plain (Date, Map, Set, class
 * instances, functions) instead of silently collapsing them to "{}" — the whole
 * job of this function is collision-resistant canonicalization, so a value that
 * loses information here would be a hole in the trust anchor.
 */
function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value as object);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(
        "Audit detail must be JSON-plain: no Date, Map, Set, or class instances. Convert to a string or plain object first.",
      );
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`Audit detail contains an unsupported value type: ${t}.`);
}

/**
 * The exact string that gets hashed for one entry. The whole field array goes
 * through the order-stable serializer, so every string is JSON-escaped and there
 * is no separator a crafted actor/action/detail could imitate (a plain join(" ")
 * would be ambiguous for values containing spaces).
 */
function canonical(e: Omit<AuditEntry, "hash">): string {
  return stableStringify([e.seq, e.ts, e.actor, e.action, e.detail, e.prevHash]);
}

export class AuditLog {
  private readonly _entries: AuditEntry[];
  private readonly hashFn: (input: string) => string;
  private readonly clock: () => string;
  private readonly genesis: string;
  private readonly onAppendCb?: (entry: AuditEntry) => void;

  constructor(opts: AuditLogOptions) {
    this.hashFn = opts.hash;
    this.clock = opts.now;
    this.genesis = opts.genesisHash ?? DEFAULT_GENESIS;
    this._entries = opts.initial ? [...opts.initial] : [];
    this.onAppendCb = opts.onAppend;
  }

  /** The hash the next entry will chain from. */
  get lastHash(): string {
    const last = this._entries[this._entries.length - 1];
    return last ? last.hash : this.genesis;
  }

  /** Append one entry and return it. */
  append(
    actor: string,
    action: string,
    detail: Record<string, unknown> = {},
  ): AuditEntry {
    const base: Omit<AuditEntry, "hash"> = {
      seq: this._entries.length,
      ts: this.clock(),
      actor,
      action,
      detail,
      prevHash: this.lastHash,
    };
    const entry: AuditEntry = { ...base, hash: this.hashFn(canonical(base)) };
    this._entries.push(entry);
    this.onAppendCb?.(entry);
    return entry;
  }

  entries(): AuditEntry[] {
    return [...this._entries];
  }

  /**
   * Recompute the whole chain and report the first entry that does not hold up:
   * a wrong seq, a broken prevHash link, or a hash that does not match the
   * entry's own fields (i.e. the entry was edited after it was written).
   */
  verify(): VerifyResult {
    let prev = this.genesis;
    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      if (!e) return { ok: false, brokenAt: i, reason: "missing entry" };
      if (e.seq !== i) {
        return { ok: false, brokenAt: i, reason: "seq out of order" };
      }
      if (e.prevHash !== prev) {
        return { ok: false, brokenAt: i, reason: "prevHash does not match previous entry" };
      }
      const recomputed = this.hashFn(
        canonical({
          seq: e.seq,
          ts: e.ts,
          actor: e.actor,
          action: e.action,
          detail: e.detail,
          prevHash: e.prevHash,
        }),
      );
      if (recomputed !== e.hash) {
        return { ok: false, brokenAt: i, reason: "entry was modified after it was written" };
      }
      prev = e.hash;
    }
    return { ok: true };
  }

  /** Append-only serialization: one JSON object per line. */
  toJsonl(): string {
    return this._entries.map((e) => JSON.stringify(e)).join("\n");
  }

  /** Load a chain from JSONL. Does not verify — call verify() after. */
  static load(jsonl: string, opts: Omit<AuditLogOptions, "initial">): AuditLog {
    const entries: AuditEntry[] = jsonl
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AuditEntry);
    return new AuditLog({ ...opts, initial: entries });
  }
}

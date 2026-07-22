# Audit and trust

This is werknario's actual trust claim. Not "an agent changed this document,"
but "an agent changed this document, and here is a verifiable chain showing
exactly what it proposed, what a named human approved, and in what order."
Tamper with it and the chain visibly breaks. This page describes how that
chain works, precisely, including where its guarantee stops.

Source: `packages/shared/src/audit.ts` (the pure, portable chain logic) and
`packages/cli/src/auditStore.ts` (the CLI's file persistence, using a real
`sha256`).

## Where it lives

`.werknario/audit.jsonl` by default: one JSON object per line, append-only.
Override the path with `WERKNARIO_AUDIT` or `--audit <path>`.

## Entry format

Every action (an agent proposing an edit, a human approving or declining, a
merge request opening, a merge, a rollback) is one `AuditEntry`:

| Field | Meaning |
|---|---|
| `seq` | 0-based position in the chain |
| `ts` | ISO timestamp |
| `actor` | `"agent:<id>"`, `"human:<name>"`, or `"system"` |
| `action` | What happened (see the vocabulary below) |
| `detail` | Structured payload — path, branch, MR iid, model, cost, verdict, whatever the action needs |
| `prevHash` | The hash of the entry immediately before this one |
| `hash` | Hash over this entry's own fields plus `prevHash` |

## How the chain is built

Each entry is hashed from a fixed, canonical string: the whole field array
`[seq, ts, actor, action, detail, prevHash]` run through an order-stable JSON
serializer.

`stableStringify` sorts object keys recursively and JSON-escapes every string,
so two semantically identical `detail` objects with differently ordered keys
hash the same way, and no crafted `actor`/`action`/`detail` value can imitate a
field separator to forge a collision. It also refuses a `detail` that is not
JSON-plain (a Date, Map, or class instance), rather than silently collapsing it
to `{}`, so a value can't quietly lose information on its way into the hash.

`prevHash` links each entry to the one before it. The very first entry links
to a genesis hash instead of a previous entry, and the CLI seeds that genesis
with the repository's own path (`x-concapps/fleetlicht-demo`, for example),
not a fixed constant. An audit log started for one repository won't silently
pass verification if pointed at a chain that actually belongs to a different
one.

## Verification

`AuditLog.verify()` replays the whole chain from the genesis hash and reports
the *first* entry that fails, with a reason:

- `seq out of order`: an entry's position doesn't match its index.
- `prevHash does not match previous entry`: the link to the prior entry is
  broken (an entry was deleted, reordered, or inserted).
- `entry was modified after it was written`: the entry's own hash doesn't
  match what its current fields recompute to (an entry was edited in place).

That covers the four ways a log entry can be tampered with:

| Tampering | What breaks |
|---|---|
| Edit an entry's fields | Its own `hash` no longer matches its recomputed fields |
| Delete an entry in the middle | Every following `seq` shifts, and the `prevHash` link at the deletion point breaks |
| Reorder two entries | `seq` and/or `prevHash` breaks |
| Insert an entry | The `prevHash` link to whatever follows it breaks |

One case `verify()` cannot catch on its own: **truncating the tail**. If you delete
the last one or more entries, what remains is still a valid chain from the genesis,
so `verify()` returns ok. A local chain has no way to know an entry *should* follow
its last one. The mitigation is an external anchor (below).

### What this guarantee does not cover

This is a hash chain, not a signed chain, and the difference matters. Nothing
in the current build cryptographically signs entries with a key that only the
legitimate actor holds. That's exactly what Sigstore commit signing (planned,
not built; see [`architecture-and-status.md`](./architecture-and-status.md))
would add.

As it stands, anyone with write access to the `.jsonl` file and the same hash
function could, in principle, rewrite the file from some point onward and
produce a chain that verifies again, by recomputing every hash after their
edit. Truncating the tail is even easier: it needs no recomputation at all.
What `verify()` catches today is silent, partial tampering in the middle of the
chain: an edit, deletion, reorder, or insert that doesn't also regenerate the
whole tail. Treat the log as tamper-evident for accidental changes and partial
edits. It isn't yet non-repudiable against someone with local file access and
the motivation to rewrite or shorten the whole thing.

**External anchor.** The git server already holds an independent, append-only
record of the events that matter most: the merge/pull requests and the merges
themselves. A truncated local log that drops a `merge` entry will disagree with
the server, which still shows the request merged. So the server is a
cross-check the local file can't rewrite. Publishing the running chain head
(the last `hash` and entry count) into each merge request would make that
cross-check automatic; that is the next step here, alongside Sigstore signing.

**Durability.** Each entry is written to the file the instant it is recorded
(the `onAppend` hook in `openAuditLog`), not flushed once at the end. A crash
mid-run therefore leaves every completed action on record, instead of losing the
whole run's trail.

## When verification actually runs

| When | What happens |
|---|---|
| On open, before appending anything | `openAuditLog()` reads the existing file, calls `verify()`, and throws, refusing to continue, if the chain doesn't check out. A tampered log is caught the next time the tool runs against it, before it can grow further. |
| At the end of every CLI run | The CLI verifies again and prints a one-line summary, e.g. `Audit: 7 entries at .werknario/audit.jsonl — chain verified.` (or `chain BROKEN.`) |

There is no separate `werknario audit verify` subcommand today.
Verification is a side effect of running the CLI against a given audit file,
not an independent check you can run on its own. To verify a log file outside
a CLI run, use the library directly:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AuditLog } from "@werknario/shared";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const log = AuditLog.load(readFileSync(".werknario/audit.jsonl", "utf8"), {
  hash: sha256,
  now: () => new Date().toISOString(),
  genesisHash: "your-org/your-repo", // must match what the CLI used to create it
});
console.log(log.verify());
```

## What gets recorded

The action vocabulary as used by the CLI today:

| Action | Actor | When |
|---|---|---|
| `task` | human | The task string is submitted |
| `propose_edit` | agent | A file edit is staged |
| `approve` / `decline` | human | Response to an approval-required tool call |
| `create_merge_request` | agent | A merge/pull request is opened |
| `add_comment` | agent | A comment is posted |
| `run_finished` | agent | The agent loop ends (stop reason, call count, cost, tokens) |
| `mergeable_check` | system | Conflict check before merge |
| `verify` | system | Optional pluggable verification (e.g. CI status), if configured |
| `approve_merge` / `decline_merge` | human | Response to the merge confirmation |
| `merge` | agent | The merge itself, with the resulting SHA if known |
| `rollback` | human | A revert was proposed |

Reads (`list_files`, `read_file`, `search_files`) are not audited. The
executor's own comment on this is direct: too noisy, no state change. The
audit log is a record of what changed and who signed off on it, not a full
request log.

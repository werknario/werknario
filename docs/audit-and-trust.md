# The tamper-evident, hash-chained audit log, and where its guarantee stops

werknario's trust claim is narrow and checkable. Every change is a reviewable
diff, proposed by a named agent and approved by a named human, and the whole
history can be verified rather than trusted. Not "an agent changed this
document," but "an agent changed this document, and here is a record showing
exactly what it proposed, what a named human approved, and in what order."
Tamper with the record in the middle and it visibly stops verifying. This page
describes how that record works, precisely, including where its guarantee stops.

Two mechanisms carry the weight, and they cover different things:

- The **audit log** records what happened, in order, as a hash chain: each
  entry carries a fingerprint (a hash) of the entry before it, so the entries
  link into one sequence you can replay and re-check end to end. It makes
  after-the-fact tampering with the sequence of events detectable.
- The **grounding gate** constrains what the agent may claim before a change is
  ever proposed to a human. It hard-blocks a team-visible write whose citation
  points at a file or line the agent never read.

Source for the chain: `packages/shared/src/audit.ts` (the pure, portable chain
logic) and `packages/cli/src/auditStore.ts` (the CLI's file persistence, using a
real `sha256`). Source for the gate: `packages/shared/src/grounding.ts`, wired
into `packages/shared/src/executor.ts`. See also [grounding.md](grounding.md)
for the citation contract in full.

## Where the log lives

`.werknario/audit.jsonl` by default: one JSON object per line, append-only.
Override the path with `WERKNARIO_AUDIT` or `--audit <path>`.

## Entry format

Every action (an agent proposing an edit, a human approving or declining, a
merge request opening, a merge, a rollback) is one `AuditEntry`:

| Field | Meaning |
|---|---|
| `seq` | 0-based position in the chain |
| `ts` | ISO timestamp, from the injected clock |
| `actor` | `"agent:<id>"`, `"human:<name>"`, or `"system"` |
| `action` | What happened (see the vocabulary below) |
| `detail` | Structured payload — path, branch, MR iid, model, cost, verdict, whatever the action needs |
| `prevHash` | The hash of the entry immediately before this one |
| `hash` | Hash over this entry's own fields plus `prevHash` |

## How the chain is built

Each entry is hashed from a fixed, canonical string: the whole field array
`[seq, ts, actor, action, detail, prevHash]` run through an order-stable JSON
serializer (`canonicalizeEntry`).

`stableStringify` sorts object keys recursively and JSON-escapes every string,
so two semantically identical `detail` objects with differently ordered keys
hash the same way, and no crafted `actor`/`action`/`detail` value can imitate a
field separator to forge a collision. It also refuses a `detail` that is not
JSON-plain (a Date, Map, Set, or class instance), rather than silently collapsing
it to `{}`, so a value can't quietly lose information on its way into the hash.

`prevHash` links each entry to the one before it. The first entry has no
predecessor, so it links to a genesis hash instead: the fixed starting anchor
the whole chain is built out from. The CLI seeds that genesis with the
repository's own path (`x-concapps/fleetlicht-demo`, for example), not a fixed
constant. An audit log started for one repository won't silently pass
verification if pointed at a chain that actually belongs to a different one.

The hash function is injected, not imported, so the chain logic stays portable:
the CLI passes Node's `sha256`, and the VS Code Web IDE extension passes the
browser's Web Crypto API. Both produce byte-identical canonical strings, so a
chain written by the extension is one the CLI and `verify` accept, and vice
versa.

## Verification

`AuditLog.verify()` replays the whole chain from the genesis hash and reports
the first entry that fails, with a reason:

- `seq out of order`: an entry's position doesn't match its index.
- `prevHash does not match previous entry`: the link to the prior entry is
  broken (an entry was deleted, reordered, or inserted).
- `entry was modified after it was written`: the entry's own hash doesn't match
  what its current fields recompute to (an entry was edited in place).

That covers the four ways a log entry can be tampered with in the middle of the
chain:

| Tampering | What breaks |
|---|---|
| Edit an entry's fields | Its own `hash` no longer matches its recomputed fields |
| Delete an entry in the middle | Every following `seq` shifts, and the `prevHash` link at the deletion point breaks |
| Reorder two entries | `seq` and/or `prevHash` breaks |
| Insert an entry | The `prevHash` link to whatever follows it breaks |

One case `verify()` cannot catch on its own: truncating the tail. If you delete
the last one or more entries, what remains is still a valid chain from the
genesis, so `verify()` returns ok. A local chain has no way to know an entry
should follow its last one. The mitigation is an external anchor (below).

### What this guarantee is, and is not

By default the log is an unsigned hash chain. `verify` exits non-zero if the
chain breaks, which is what makes silent middle-of-chain tampering detectable.
On its own an unsigned chain does not prove who produced it: anyone with write
access to the `.jsonl` file and the same hash function could, in principle,
rewrite the file from some point onward and produce a chain that verifies again
by recomputing every hash after their edit. Truncating the tail is even easier;
it needs no recomputation at all. So treat an unsigned log as tamper-evident for
accidental changes and partial edits, not as proof against someone with local
file access and the motivation to rewrite the whole thing.

Two things close that gap: optional signing (below) and the external anchor
(further below).

### Signing (optional, self-hosted)

Signing adds what the hash chain cannot: non-repudiation. With a key configured,
each run signs the chain head with Ed25519 and appends a signature checkpoint, so
a tamperer who re-chains the log still cannot forge a signature over the new head
without the private key. It uses node's built-in crypto: no key service, no
transparency log, nothing leaves the machine, so it stays EU-resident.

```bash
werknario keygen --out werknario-signing            # writes .key (private) and .pub (public)
export WERKNARIO_SIGNING_KEY=werknario-signing.key  # each run now signs the chain head
werknario verify .werknario/audit.jsonl --pubkey werknario-signing.pub
```

`verify --pubkey` reports how many checkpoints verified for that key and fails if
a signed head was altered. Keep the private key off machines that only need to
verify; share the public key freely.

The heavier keyless route — Sigstore (Fulcio) with a transparency log (Rekor) —
would add third-party timestamping and an OIDC-bound identity on top. Rekor is a
public log by default, so a self-hosted Rekor is a prerequisite for that route
under EU residency; it stays on the roadmap.

### External anchor

The git server already holds an independent, append-only record of the events
that matter most: the merge requests and the merges themselves. When the CLI
opens a merge request, it stamps the running chain head into the request
description:

```
werknario audit anchor: N entries, head <hash>
```

(`packages/cli/src/runTask.ts`.) A local log later shortened below that point no
longer matches the anchor the server holds, and the server is a record the local
file cannot rewrite. So tail truncation, the one gap `verify` can't close on its
own, is caught by cross-checking the local head against the MR-stamped head on
the Git server.

Taken together, that fixes what the log is worth as evidence: internal
tamper-evidence for partial edits, anchored to the merge-request head the Git
server independently holds, and — with signing enabled — non-repudiation against
the key holder. A public transparency log (Sigstore/Rekor), which would add
third-party timestamping for court-grade evidence, remains on the roadmap.

### Durability

Each entry is written to the file the instant it is recorded (the `onAppend`
hook in `openAuditLog`), not flushed once at the end. A crash mid-run therefore
leaves every completed action on record, instead of losing the whole run's
trail.

## When verification runs

| When | What happens |
|---|---|
| On open, before appending anything | `openAuditLog()` reads the existing file, calls `verify()`, and throws, refusing to continue, if the chain doesn't check out. A tampered log is caught the next time the tool runs against it, before it can grow further. |
| At the end of every CLI run | The CLI verifies again and prints a one-line summary, e.g. `Audit: 7 entries at .werknario/audit.jsonl — chain verified (head 3f2a9c1b8e04).` (or `chain BROKEN`). |

There is also a standalone command for a check outside a run, useful for an
auditor or a CI job. For a source build (`npm install && npm run build`), the
CLI is not on `PATH`; invoke it through Node:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
node packages/cli/dist/cli.js verify .werknario/audit.jsonl --genesis owner/repo
```

It prints the result and exits non-zero if the chain is broken (exit 0 on a good
chain). Without `--genesis` it reads the genesis seed from the file's own first
entry, which still catches tampering in the middle of the chain; with
`--genesis` it also catches a rewritten first entry or a log pointed at the
wrong repository. On a good chain the output reads:

```
Audit .werknario/audit.jsonl — chain verified (7 entries, genesis owner/repo).
```

Optionally, to get the short `werknario verify …` form used in the Docker image,
link the CLI once: `npm link -w @werknario/cli` from the repo root. After that `werknario verify
.werknario/audit.jsonl` runs the same check.

To verify a log file from your own code, use the library directly:

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
| `create_merge_request` | agent | A merge request is opened (also stamps the chain head as the anchor) |
| `add_comment` | agent | A comment is posted |
| `run_finished` | agent | The agent loop ends (stop reason, call count, cost, tokens) |
| `mergeable_check` | system | Conflict check before merge |
| `verify` | system | Optional pluggable verification (e.g. CI status), if configured |
| `approve_merge` / `decline_merge` | human | Response to the merge confirmation |
| `merge` | agent | The merge itself, with the resulting SHA if known |
| `rollback` | human | A revert was proposed |

Reads (`list_files`, `read_file`, `search_files`) are not audited. The
executor's own comment on this is direct: too noisy, no state change. The audit
log is a record of what changed and who signed off on it, not a full request
log.

## The grounding gate: blocking fabricated origin

The audit log records what happened. The grounding gate constrains what the
agent is allowed to claim in the first place, before a human ever sees a
proposal. The git repository is the single source of truth: the agent may only
assert what it has actually read in a file, and it must cite where.
`read_file` returns its content with line numbers, so the agent can cite exact
spans as `[Beleg: <path>:L<start>-L<end>]` (the bundled demo substrate is a
German-language example, so the marker token is German).

Before a team-visible write (opening a merge request, or posting a comment), the
executor runs `validateCitations` against a ledger of what was actually read in
this session. A citation that points at a file the agent never read, or at lines
past the length it saw, or at a backwards span, is fabricated origin. It hard-
blocks the write: the merge request is not opened, and the agent is told to read
the cited file and correct the citation before trying again. This runs before
the human approval step, so an invented citation never reaches a person for
sign-off.

There is a second, deliberately weaker check. `checkNumberGrounding` verifies
that each number in a cited sentence actually appears in the cited line. This is
advisory, not a block. A number can legitimately be computed or aggregated (a
sum does not appear verbatim in any single source line), so a mismatch is
attached as a note for the human reviewer rather than stopping the write. Do not
read this as "blocks wrong numbers." It flags numbers whose source line does not
contain them, and leaves the judgement to the approver.

One honest boundary: the gate checks that a citation points at something really
read, not whether the cited line actually supports the claim. Content-level
support (groundedness scoring) is a later step. What is enforced today is that
the origin is real.

For the full citation contract and the retrieval side that feeds it, see
[grounding.md](grounding.md). For which paths an agent may write at all, see
[permissions.md](permissions.md). For a first end-to-end run that produces a
verifiable log, see [getting-started.md](getting-started.md).

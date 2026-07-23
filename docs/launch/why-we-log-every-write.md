# Why we log every agent write, and where that guarantee stops

An agent (software that carries a task through to the end, not just answers)
that touches your documents leaves you with a question a chat transcript never
answers: what did it actually change, and who agreed to it. werknario's answer
is a record you can re-check instead of a promise you have to accept. Every
change is a reviewable diff, proposed by a named agent and approved by a named
human, and the whole history can be verified rather than trusted.

This essay is about the second half of that sentence, the part most tools skip:
the log. What goes into it, what one command tells you about it, and the exact
point where its guarantee runs out. That last part matters more than the
mechanism, because a guarantee you can't see the edge of is a guarantee you
can't rely on.

## What gets logged, and what does not

Two kinds of thing happen during a run. The agent reads files, and the agent
proposes changes that a human then approves or declines. Only the second kind is
recorded. Reading is not audited: a read changes no state, and logging every
`list_files` and `read_file` would bury the entries that matter under traffic.
The log is a record of what changed and who signed off on it, not a request log.

So each entry in `.werknario/audit.jsonl` is one action with weight behind it:
the task being submitted, an edit being staged (`propose_edit`), a human's
`approve` or `decline`, a merge request opening (`create_merge_request`), the
conflict check before a merge, the merge itself, a rollback. One JSON object per
line, appended the instant it happens. A crash mid-run leaves every completed
action on record rather than losing the trail, because the file is written per
entry, not flushed once at the end.

## The chain

The entries are not just a list. Each one carries a `prevHash`, the hash of the
entry immediately before it, and its own `hash`, computed over its fields plus
that `prevHash`. The first entry has no predecessor, so it hashes against a
genesis seed. The CLI seeds that genesis with the repository's own path, so a
log built for one repo does not quietly pass when pointed at a chain that
belongs to another.

The hash runs over a canonical string. `stableStringify` sorts object keys
recursively and JSON-escapes every value, so two `detail` objects with the same
content but different key order hash identically, and no crafted field value can
imitate a separator to forge a collision. It refuses a `detail` that isn't
JSON-plain (a Date, a Map, a class instance) rather than silently flattening it,
because a value that lost information on its way into the hash would be a hole in
the whole thing.

Because each entry seals the one before it, tampering in the middle of the chain
does not stay hidden. Edit a field and that entry's own hash stops matching what
its fields recompute to. Delete an entry and the `prevHash` link at that point
breaks and every following `seq` shifts. Reorder or insert, and a link breaks
the same way.

## The command, and its exit code

The record is only worth something if checking it is cheap and honest. So the
check is one command, offline, no keys and no server:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

It replays the chain from the genesis and reports the first entry that fails,
with a plain reason: `seq out of order`, `prevHash does not match previous
entry`, or `entry was modified after it was written`. On a good chain it prints
a summary and exits 0:

```
Audit .werknario/audit.jsonl — chain verified (7 entries, genesis owner/repo).
```

If the chain is broken it exits non-zero. That exit code is the point. It makes
the check something a CI job or a script can gate on, not something a person has
to read and interpret. The verdict is not "looks fine" from a reviewer; it is a
process that returns zero or one. A hash chain, not a signature: `verify` exits
non-zero if the chain breaks.

The same check runs without being asked. `openAuditLog()` verifies the existing
file before it appends anything and refuses to continue if the chain doesn't
hold, so a tampered log is caught the next time the tool runs against it, before
it can grow. The CLI verifies again at the end of every run and prints a
one-line summary. And a chain the browser extension wrote passes the CLI's
`verify`, because both produce byte-identical canonical strings from the same
`canonicalizeEntry`.

## Where the guarantee stops

Here is the edge, stated plainly, because a launch that hides it is exactly the
kind of over-claim werknario exists to argue against.

An unsigned hash chain proves the sequence is internally consistent. It does not
prove who produced it. Anyone with write access to the `.jsonl` file and the
same hash function could, in principle, rewrite the file from some point onward
and recompute every hash after their edit, producing a chain that verifies
again. Treat an unsigned log as tamper-evident for accidental changes and
partial edits, not as proof against someone with local file access and the
motivation to rewrite the whole thing.

One case is easier still: truncating the tail. Delete the last one or more
entries and what remains is a valid chain from the genesis, so `verify` returns
ok. A local file has no way to know an entry should have followed its last one.
`verify` cannot close this gap on its own.

Two things close it, and both are worth naming precisely so neither gets
oversold.

The first ships and always runs. When the CLI opens a merge request it stamps
the current chain head into the request description:

```
werknario audit anchor: N entries, head <hash>
```

(`packages/cli/src/runTask.ts`.) The Git server now holds an independent,
append-only record of where the log stood. A local log later shortened below
that point no longer matches the anchor the server holds, and the server is a
record the local file cannot rewrite. So tail truncation, the one gap `verify`
can't catch by itself, is caught by cross-checking the local head against the
head stamped on the Git server.

The second is opt-in. Optional Ed25519 signing (`werknario keygen`, then
`verify --pubkey`) adds what the hash chain cannot, non-repudiation: each run
signs the chain head, so a tamperer who re-chains the log still cannot forge a
signature over the new head without the private key. It uses Node's built-in
crypto and nothing leaves the machine, so it stays EU-resident. It is off by
default, and the log is a hash chain, not a signature, unless you turn it on.
The heavier keyless route, Sigstore with a public transparency log for
third-party timestamping, stays on the roadmap.

## See it for yourself

The honest way to read all of this is to run it. The offline demo produces a
real log against an in-memory repo, with a scripted model, no account and no
network:

```bash
npm install
npm run build
npm run demo
```

The run ends with a verified chain. Then break it on purpose: open
`.werknario/audit.jsonl`, change a character in any entry, and run `verify`
again. It exits non-zero and points at the entry that no longer holds. That is
the whole claim, reduced to something you can falsify in one edit.

For the full mechanism, including the entry format and every recorded action,
see [audit-and-trust.md](../audit-and-trust.md). For the other guardrail, the
citation gate that blocks a fabricated source before a merge request is ever
opened, see [grounding.md](../grounding.md).

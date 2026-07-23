# Show HN launch copy

Copy-ready launch asset for the single Show HN post. English, for the global
OSS audience. Everything below is grounded against the repo's code and docs
(`docs/architecture-and-status.md`, `docs/audit-and-trust.md`,
`docs/grounding.md`, `docs/permissions.md`, `README.md`) as of this draft.

> **Editor's note, not posted.** Two things gate this post, per the marketing
> plan (`werknario/docs/marketing/2026-07-22-marketing-konzept.md`, section 5):
> (1) the fabricated-citation demo has to exist as a recorded cast before you
> post, because `npm run demo` today runs the happy path only; the citation gate
> itself is built and covered by the executor and grounding unit tests, but the
> second mock path that shows it blocking a merge is a pre-launch build item.
> (2) Unify the invocation so a cold cloner can run the exact `verify` line you
> show. The copy below uses the source-build form `node packages/cli/dist/cli.js`
> throughout and mentions the optional `npm link`, matching
> `docs/architecture-and-status.md`. Replace the `[recorded cast]` placeholder
> with the real asset link before posting.

---

## Title (primary)

Reads what the product is, 78 characters.

```
Show HN: werknario, an office paperwork agent where every change is a Git diff
```

## Title (alternative, mechanism-forward)

Kept as a comment hook, 78 characters.

```
Show HN: werknario, a fake citation blocks the merge; the log verifies offline
```

---

## Post body

Runs offline, no key and no server:

```
git clone <repo> werknario && cd werknario
npm install
npm run build
npm run demo
```

An agent here is software that carries a task through to the end, not just
answers. The demo drives the whole flow against an in-memory repo with a scripted
model: the agent reads a session note, proposes a new file as a diff, opens a
merge request, merges it, and writes an audit log. The last line reads
`Audit: N entries at .werknario/audit.jsonl — chain verified.` Check that log
on its own, and it exits 0 on a good chain and non-zero if a byte moved:

```
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

(An optional one-time `npm link -w @werknario/cli` puts a short `werknario` on
your PATH if you would rather drop the prefix.)

werknario points one at your documents in a Git repo, GitLab or GitHub.
The idea is not that a model writes your files. Plenty of tools do that. The
idea is the mechanism: every change is a reviewable diff, proposed by a named
agent and approved by a named human, and the whole history can be verified
rather than trusted.

Two mechanisms carry that. Before a merge request is even opened, the executor
checks every citation in the proposal against a ledger of what the agent
actually read this session. A citation to a file or line it never read is
fabricated origin, and it hard-blocks the merge request before a human ever
sees it. And every write, approval, and merge is appended to a hash-chained log
where each entry seals the one before it, so a later edit, deletion, reorder, or
insertion stops the chain from verifying. Here is the fabricated citation being
refused, then the chain verifying: [recorded cast].

What runs today, and what does not. The offline mock path is proven end to end;
GitLab and GitHub are covered by the test suite against their APIs.

| Runs today (built and tested) | Designed, not built yet |
|---|---|
| CLI, full flow: read repo, propose, human approves, open merge/pull request, conflict check, human approves merge, merge, revert | Live hosted browser demo. The VS Code Web IDE extension, the LLM proxy, and the gallery-proxy registry are built and tested; what is missing is a DNS record and a Caddy entry on the host so a real GitLab Web IDE can reach them |
| Backends: GitLab, GitHub, and an in-memory mock | Optional keyless Sigstore with a public transparency log (opt-in self-hosted Ed25519 signing of the log is built) |
| Providers: mock, Anthropic, AWS Bedrock (EU inference profile), and one OpenAI-compatible provider for Mistral / Kimi / DeepSeek / Qwen / self-hosted models | A full CI-verify-and-auto-rollback loop. The conflict check runs and `--verify-cmd` blocks a merge on a non-zero exit; `rollback` exists and is audited, but nothing reverts automatically off a post-merge CI signal |
| Grounding gate: a citation to a file or line the agent never read hard-blocks the merge request; the number-coverage check is advisory | A vector index for retrieval, held behind a measured Recall@k threshold |
| Path permission policy: which agent may write which path globs | |
| Tamper-evident, hash-chained audit log plus offline `verify`; opt-in Ed25519 signing (`keygen` / `verify --pubkey`) | |

Apache-2.0, Node 20+. Docker one-liner if you prefer: `docker compose run --rm demo`.
The author is in the comments.

---

## First author comment

Post this yourself as the first comment.

> Author here. Honest scope: the offline mock path is proven end to end, and the
> GitLab and GitHub backends are unit-tested against their APIs. Four limits I
> would name myself, each one deliberate.
>
> The audit log is a hash chain, not a signature. `verify` catches an edit,
> deletion, reorder, or insertion in the middle of the chain and exits non-zero,
> but it cannot detect tail truncation on its own, so the chain head is stamped
> into the merge request description to anchor it on the Git server. Opt-in
> Ed25519 signing adds non-repudiation; keyless Sigstore with a public
> transparency log is on the roadmap.
>
> The path permission policy controls which paths the agent may write. The
> named-approver check runs in the CLI against the authenticated token holder
> (`GET /user` on GitLab or GitHub), and `--yes` does not bypass it, but the VS
> Code extension surface does not run that check yet, so there the approver label
> is self-declared. Org-wide enforcement across surfaces is on the roadmap; do
> not read it as an org-wide four-eyes control.
>
> In grounding, only the origin check is a hard block: a citation to a file or
> line the agent never read stops the merge request. The number-coverage check
> is advisory, because a number can legitimately be computed or aggregated, so a
> mismatch is a note for the reviewer, not a rejection.
>
> GitHub revert is a simplified tree swap, not a three-way `git revert`, and
> nothing triggers a rollback automatically from a post-merge CI signal; it is an
> explicit, human-triggered action. Happy to go into why each of these is where
> it is.

---

## Pre-written replies to the three predictable objections

Keep these ready. Answer on mechanism, dry, no scoreboard against named tools.

### "Why not just point Aider or OpenHands at a docs repo?"

> You can, and a coding agent will happily edit files and open a pull request.
> werknario adds what a documents workflow needs and a code workflow does not.
> A citation gate runs before the merge request exists: if the agent cites a
> file or line it never read this session, the proposal is blocked before
> anything is opened, so a confident fabrication does not become a diff. A path
> permission policy scopes the agent to path globs, so a task about one folder
> cannot rewrite the whole repo. The log is a hash-chained record you verify
> offline instead of trusting. The approver is a non-developer reading a diff,
> not code. And the router refuses to send personal data to a non-EU model
> unless you override it. None of that is what a generic coding agent is for.

### "A hash chain is not a signature."

> Correct, and by default the log is exactly that: an unsigned hash chain, not a
> signature. What it gives you is that middle-of-chain tampering, editing,
> deleting, reordering, or inserting an entry, breaks the chain and `verify`
> exits non-zero. What it does not give you by default is proof of who produced
> it: anyone with write access to the file and the same hash function could
> rewrite the chain from some point onward and recompute the hashes after their
> edit. Tail truncation is even easier and `verify` cannot catch it alone. Two
> things close that gap, and the docs are explicit about both. The chain head is
> stamped into every merge request, so the Git server holds an independent record
> a shortened local file no longer matches. And opt-in Ed25519 signing signs the
> chain head, so a re-chained log cannot forge a signature over the new head
> without the private key. A public transparency log (Sigstore/Rekor) for
> court-grade timestamping is on the roadmap, not claimed today.

### "The approver is not actually enforced."

> Partly. The path permission policy, which paths the agent may write, is
> enforced today. The named-approver check is enforced in the CLI: before the
> merge prompt it resolves the approvers for every touched path and checks them
> against the authenticated token holder (`GET /user`), writes a `merge_denied`
> entry and refuses the merge if that person is not on the list, and `--yes` does
> not bypass it. What is not enforced yet is the VS Code extension surface, where
> the approver label is still self-declared, and org-wide identity across every
> surface. So it is a real control on the CLI path bound to an authenticated
> identity, and an honour system on the extension path until cross-surface SSO
> lands. I would rather say that plainly than call it four-eyes everywhere.

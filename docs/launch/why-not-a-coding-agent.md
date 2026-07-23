# Why not just point a coding agent at your docs repo?

You can. A coding agent will read files, edit them, and open a pull request, and
for prose in a Git repository that mostly works. So this page is not an argument
that you cannot do it. It is an account of what werknario adds that a general
coding agent does not, told as mechanisms you can run and check rather than
promises.

An agent here is software that carries a task through to the end, not just
answers. The line that describes werknario is narrow on purpose: every change is
a reviewable diff, proposed by a named agent and approved by a named human, and
the whole history can be verified rather than trusted. The difference from a
coding agent lives in three words of that sentence: proposed, approved, and
verified. Each is a concrete gate in the code, and each is covered below.

## The short version

A coding agent optimises for landing a correct change. werknario optimises for
being able to answer, afterwards, "who proposed this, who approved it, and can I
prove the record was not edited." Those are different jobs. When the file being
changed is a contract, an intake note, or a decision that a colleague, an
auditor, or a works council may later ask about, the second job is the one that
matters, and a coding agent does not do it.

What follows is the same list, mechanism by mechanism.

## A citation gate runs before the merge request exists

When werknario writes a claim about your documents, it has to cite where it read
that claim, in the form `[Beleg: <path>:L<start>-L<end>]`. Before a team-visible
write runs (opening a merge request, or posting a comment), the executor checks
every citation in the text against a ledger of what the agent actually read this
session. A citation pointing at a file the agent never opened, or at lines past
the length it saw, is fabricated origin, and it hard-blocks the write. The merge
request is not opened, and the agent is handed back a correctable error telling
it to read the cited file first. Because this runs before the human approval
step, an invented source never reaches a person for sign-off.

A general coding agent has no such gate. A confident fabrication becomes a diff,
and the reviewer is the only thing between it and a merge.

One honest boundary, held exactly as the docs hold it. The origin check is a
hard block: the citation must point at something really read. A second check,
number coverage, verifies that each number in a cited sentence also appears in
the cited line, and that one is advisory, not a block. A number can be computed
or aggregated (a sum does not appear verbatim in any single source line), so a
mismatch is attached as a note for the reviewer rather than stopping the write.
Read it as "a fabricated citation blocks the merge request," not as "blocks
wrong numbers." The gate checks that the origin is real, not that the cited line
supports the claim in substance; groundedness scoring is a later, deliberately
deferred step. Source: `packages/shared/src/grounding.ts`, wired into
`packages/shared/src/executor.ts`.

## A path permission policy controls which paths the agent may write

`.werknario/policy.json` controls which paths a given agent may write, as glob
rules. A non-empty `allow` list inverts the permissive default: the agent may
write only paths that match, and everything else is refused with a reason, so a
task about one folder cannot rewrite the whole tree. `deny` wins over `allow`
for the exceptions inside an allowed area. There is no policy file out of the
box (the tool works before you write one, and prints a one-line notice that no
policy is present), and the repo ships a start-closed template at
`.werknario/policy.starter.json` for regulated setups that should start closed.
A blocked write does not crash the run; the executor returns the reason to the
agent as a tool error, so it picks a different path or asks the human. Source:
`packages/shared/src/policy.ts`, wired into `packages/cli/src/cli.ts`.

The policy also carries an `approvers` block: which human ids may approve a
change touching a given path. Here the scope is worth stating precisely, because
it differs by surface. In the CLI, the approver check runs against the
authenticated identity: for a GitLab or GitHub backend the acting human is read
from the access token (`GET /user`), and a merge is blocked, with a
`merge_denied` audit entry, if that person is not on the `approvers` list for a
touched path, and `--yes` does not bypass it. The VS Code Web IDE extension
surface does not yet run this check, so on that surface the approver is
self-declared. Organisation-wide identity across every surface (one SSO) is on
the roadmap, so treat the extension approver as intent, not identity, until that
lands. Source: `packages/shared/src/policy.ts`, `permissions.md`.

## The approver is a human reading a diff, not code

Every write and the merge itself pause for a human `yes`. The agent stages an
edit with `propose_edit`; the human is shown a diff of the current and proposed
content; opening the merge or pull request is approval-required; and the merge
is a second, separate approval, the point of no automatic return. Each approve
or decline is recorded. A coding agent can be configured to ask before it acts,
but the asking is a convenience, not a recorded step, and there is usually no
artefact afterwards that a non-author can replay.

The non-technical case matters for documents work. A non-developer can approve
through the VS Code Web IDE extension surface, which shows the staged change and
its diff and offers the same accept action without a terminal. Pair that surface
with your own review process for now, since it does not yet enforce the
`approvers` list.

## The log is offline-verifiable

Every step of a run appends one entry to a hash-chained audit log
(`.werknario/audit.jsonl`): the task, each proposal, each human approve or
decline, the merge request, the merge, a rollback. Each entry seals the one
before it, so any later edit, deletion, reordering, or insertion in the middle
of the chain is detectable. `node packages/cli/dist/cli.js verify
.werknario/audit.jsonl` replays the chain and exits non-zero if it breaks. It
also runs automatically on open (a tampered log is caught the next time the tool
runs against it) and at the end of every run.

This is a hash chain, not a signature. On its own it is tamper-evident for
accidental changes and partial edits, not proof against someone with local file
access who rewrites the whole file from some point onward. Two things narrow
that gap, and the docs are explicit about both. First, the one case `verify`
cannot catch alone is tail truncation: a log with its last entries chopped off
is still a valid chain from the start. The mitigation is an external anchor. When
the CLI opens a merge request it stamps the current chain head (entry count and
hash) into the request description, so the Git server holds a reference the local
file cannot rewrite, and a locally shortened log no longer matches it. Second,
optional Ed25519 signing (`keygen`, then `verify --pubkey`) adds
non-repudiation against the key holder; it is opt-in, self-hosted, and nothing
leaves the machine. The heavier keyless route (Sigstore with a public
transparency log for third-party timestamping) is on the roadmap, not shipped.
Source: `packages/shared/src/audit.ts`, `packages/cli/src/auditStore.ts`.

A coding agent leaves you commit history, which tells you what changed and when,
but not the proposal that preceded it, the human who approved it, or a check
that the record itself was not edited after the fact.

## The router refuses to send personal data to a non-EU model by default

Before the first model call, the CLI resolves the route's data residency and
blocks a non-EU route with a clear message. Residency is a property of the
route, not just the model name: the same Claude model counts as EU over
Bedrock's EU region (`AWS_REGION=eu-central-1`) and non-EU over Anthropic's
direct US API. `mock` is local and exempt; `openai-compatible` models follow the
registry (Mistral and the EU-hosted entries are EU, direct Kimi and DeepSeek are
not); and anything unrecognised is treated as non-EU, so the failure is safe.
Set `WERKNARIO_ALLOW_NON_EU=1` to override, which prints a warning and proceeds,
and only for data that carries no personal information. Source:
`packages/shared/src/routing.ts`, called from `packages/cli/src/cli.ts`;
registry in `packages/shared/src/models.ts`.

To be clear about what this is: a default that keeps the route inside the EU
unless you deliberately step outside it. It supports EU data residency for the
model call. It does not by itself make a deployment GDPR-compliant, and it is not
described as legally required. Compliance depends on the whole system and how you
run it, not on one gate.

## Revert is a human action, and it is backend-aware

werknario can propose a revert, as a new branch and request that a human
approves like any other change, and the revert is audited. Nothing triggers it
automatically from a post-merge CI signal. A conflict check runs before every
merge, and `--verify-cmd <cmd>` can run your own lint, tests, or a CI-status
probe and block the merge on a non-zero exit, but the full CI-verify-and-auto-
rollback loop is designed, not built. `rollback` exists and works; it is offered
as an explicit, human-triggered action, not an automatic reaction.

The revert itself differs by backend, and the difference is documented rather
than hidden: GitLab uses its own revert endpoint, a real three-way revert
wrapped in a merge request; GitHub's revert is a simplified tree swap wrapped in
a pull request. See `backends.md`.

## What a coding agent already does well

Landing code changes. If your repository is a codebase and the goal is a correct
patch reviewed by developers who read diffs for a living, a general coding agent
is a good fit, and werknario is not trying to replace it. werknario earns its
place when the writer is an agent, the reader is not a developer, and someone
later needs to check the record instead of trusting it. That is a documents
problem, not a coding one.

## What this is not

werknario is not a compliance product and does not claim to make you compliant.
The residency gate supports EU data residency for the model call; the audit log
supports an after-the-fact check of what happened. Whether that satisfies a
given obligation is a question for the whole deployment, not this tool alone. The
honest split between what runs today and what is designed but not built yet lives
in [architecture-and-status.md](../architecture-and-status.md), and the exact
guarantees and limits of the audit log are in
[audit-and-trust.md](../audit-and-trust.md).

## See it yourself

The whole flow runs offline, with no account, no key, and no server. The
provider is a scripted mock and the backend is an in-memory repository, so
nothing real is read or written. It reads a note, proposes a new file, opens a
merge request, merges it, and writes a verifiable audit log:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

Then check the log the run just wrote:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

It exits 0 on a good chain and non-zero if a line was edited, deleted, or
reordered. That is the difference this page is about, in two commands you can run
before you decide anything.

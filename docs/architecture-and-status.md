# Architecture and status

werknario proposes changes to your documents as reviewable, auditable diffs.
Git, either GitLab or GitHub, is the document store. An agent (software that
carries a task through to the end, not just answers) proposes the change; a
named human approves it. Every change is a reviewable diff, proposed by a named
agent and approved by a named human, and the whole history can be verified
rather than trusted.

This page draws a hard line between what runs today and what is planned, walks
the supervised flow step by step, and lays out the monorepo.

Runnable commands in this repo's docs use the source-build form
`node packages/cli/dist/cli.js <args>`, because the bare `werknario` command is
not on PATH after `npm install`. An optional one-time `cd packages/cli && npm
link` puts a short `werknario` on PATH if you prefer it.

## What runs today

Everything in this section is built and tested. You can watch the whole flow run
offline against the mock backend and mock provider, with no credentials and no
network. See [`configuration.md`](./configuration.md) and
[`recipes.md`](./recipes.md) for the commands.

### The supervised flow

The CLI (`packages/cli`) drives the whole flow in one process, and the extension
drives the same agent loop. Seven supervised steps, plus an optional rollback.

1. Read. The agent lists and reads files with `list_files`, `read_file`, and
   `search_files`. Every read is recorded in a per-conversation ledger that the
   grounding gate checks later. Reads are not audited: they change no state.

2. Propose. The agent stages an edit with `propose_edit`. The path guard from
   the permission policy can block the write before it is staged. The human is
   shown a diff of the current and proposed content. Recorded as a `propose_edit`
   audit entry.

3. A human approves the team-visible write. Opening a merge request is
   approval-required. Before the human is asked, the grounding gate validates
   every citation in the request description against what the agent actually
   read. A citation to a file or line the agent never read hard-blocks the
   request, so a fabricated source never reaches the human for approval. The
   human's approve or decline is audited.

4. Open the merge or pull request. `create_merge_request` commits the staged
   edits to a new branch and opens the request. The current audit chain head
   (entry count and hash) is stamped into the request description as an anchor,
   so the Git server holds an immutable record of where the log stood. Recorded
   as `create_merge_request`.

5. Conflict check. Before any merge, the loop confirms the request is free of
   conflicts with newer edits. An optional verification step runs here too:
   `--verify-cmd <cmd>` runs any shell command (your lint, your tests, or a
   CI-status probe) and blocks the merge on a non-zero exit. Both are audited.

6. A human approves the merge. This is the point of no automatic return. Approve
   or decline is audited.

7. Merge. The change lands. Recorded as `merge`, with the merge commit SHA when
   the backend returns one.

Optional rollback. `rollback` proposes a revert as a new branch and request,
which a human approves like any other change, and it is audited. Nothing triggers
it automatically from a post-merge CI signal; it is offered as an explicit,
human-triggered action.

Alongside the flow, `verify` checks an audit log on its own
(`node packages/cli/dist/cli.js verify .werknario/audit.jsonl`), and `eval` runs
built-in scenarios against the configured model. A grounding side note: the
number-coverage check is advisory, not a block. A merge request whose figures are
not all covered by a cited source gets a warning appended to the success message
for the reviewer, not a rejection. See `packages/shared/src/grounding.ts`.

### Backends

Three backends exist: GitLab (REST), GitHub (REST plus the Git Data API for
atomic multi-file commits), and `mock` (in-memory, zero setup). See
[`backends.md`](./backends.md), including the caveat that GitHub's revert is a
simplified tree swap, not a three-way `git revert`.

### Providers and models

Four model providers exist: `mock`, `anthropic`, `bedrock` (AWS, EU inference
profile), and `openai-compatible` (one provider covering Mistral, Kimi, DeepSeek,
Qwen, and self-hosted vLLM-style endpoints). A model registry
(`packages/shared/src/models.ts`) carries price, context window, tool-use
support, and a data-residency flag (`eu` / `self-host` / `non-eu`). A
deterministic router can pick a cheaper model for simple steps and a stronger
one for sensitive paths. A token ledger enforces an optional cost budget. Prompt
caching is wired for the Anthropic and Bedrock providers. See
[`providers-and-models.md`](./providers-and-models.md).

### Permissions and grounding

A permission policy (`.werknario/policy.json`) controls which agent may write
which path globs, defaulting to permissive. See [`permissions.md`](./permissions.md).
The CLI enforces the `approvers` list against the authenticated token identity
(`GET /user`): `closeLoop` runs `checkApprover` before the merge prompt, records a
`merge_denied` audit entry, and `--yes` does not bypass it. Cross-surface
enforcement (the extension) and org-wide identity binding (SSO) remain the roadmap
step. The grounding contract, described in the flow above, limits the agent to what
it read this session.

### The audit log

A tamper-evident audit log (`.werknario/audit.jsonl`) is append-only and
hash-chained. It is a hash chain, not a signature. Each entry is written to disk
the instant it happens, the chain is checked on open and at the end of every run,
and `verify` exits non-zero if the chain breaks. `verify` cannot detect tail
truncation on its own, which is why each merge request description carries the
chain head: the Git server anchors the log against being shortened. See
[`audit-and-trust.md`](./audit-and-trust.md) for exactly what the hash chain does
and does not protect against.

### The extension, proxy, and registry

The VS Code Web IDE extension (`packages/extension`), the standalone LLM proxy
server (`packages/proxy`) for the browser case, and the gallery-proxy registry
service (`registry/`) that lets a self-hosted GitLab instance's Web IDE install
the extension from a custom marketplace are all built and tested. The extension
runs the same agent loop as the CLI and records the same audit chain: an async
Web Crypto hash chain persisted in VS Code's workspaceState, using the shared
`canonicalizeEntry` so its hashes are byte-identical to the CLI's, and a chain
started in the extension passes the CLI's `verify`. It also shows a live token
counter. The extension's integration tests run in a real headless browser
extension host via `@vscode/test-web`, and the registry has its own unit tests
and a CI-built container image.

The one piece not up yet is a live, publicly reachable hosted demo. The code is
built; reaching the extension from a real GitLab Web IDE needs two infrastructure
steps on the host, a DNS record and a Caddy reverse-proxy entry, before the
instance's marketplace can be pointed at it. See
[`DISTRIBUTION.md`](./DISTRIBUTION.md) for the two outstanding steps and
everything already done around them.

## What is not built yet

| Item | Status |
|---|---|
| Supabase operative substrate | Planned, not built |
| Zitadel identity | Planned, not built |
| Cognee memory service | Planned, not built. Memory today is a Git-native decision log (`packages/shared/src/memory.ts`): versioned, citable documents retrieved with the existing `search_files` / `read_file`, no external store |
| Deferred vector index for memory retrieval | Deferred behind a measured Recall@k threshold, not built. Retrieval currently runs on keyword search over the decision log |
| Keyless Sigstore with a public transparency log | Planned, not built. Optional self-hosted Ed25519 signing of the audit log is built (`keygen` / `verify --pubkey`); the keyless Sigstore/Rekor route, which adds third-party timestamping, is the roadmap step (see [`audit-and-trust.md`](./audit-and-trust.md)) |
| Full CI-verify-and-auto-rollback loop | Partially built. The conflict check before merge is real and always runs; further verification is a pluggable hook (`CloseLoopDeps.verify`) with a shipped implementation, `--verify-cmd <cmd>`, which runs any shell command and blocks the merge on a non-zero exit. `rollback()` exists, is audited, and works, but nothing calls it automatically from a post-merge CI signal. It is offered as an explicit, human-triggered action, not an automatic reaction |
| Live hosted browser demo | The extension, proxy, and registry service are built and tested. Reaching them from a real GitLab Web IDE needs DNS and Caddy on the target host (see [`DISTRIBUTION.md`](./DISTRIBUTION.md)) |

## Monorepo layout

| Package | What it does |
|---|---|
| `packages/shared` | Provider-agnostic core: message/tool types, the pure agent loop, the tool executor (grounding, approval gate, path-traversal guard), the audit log, the permission model, the model registry, the token ledger, the deterministic router |
| `packages/gitlab-client` | `fetch`-based GitLab REST client (Node and browser) and the GitLab `ToolBackend` implementation |
| `packages/github-client` | `fetch`-based GitHub REST plus Git Data API client and the GitHub `ToolBackend` implementation |
| `packages/proxy` | Stateless LLM gateway: pluggable providers (mock, anthropic, bedrock, openai-compatible), CORS, bearer auth. Used standalone by the browser extension and in-process (no HTTP) by the CLI |
| `packages/cli` | The command-line entry point: wires a backend, a provider, an audit log, and a policy together, drives the terminal approval flow, and closes the loop (conflict check, merge, revert) |
| `packages/extension` | VS Code Web IDE extension for the GitLab Web IDE: webview chat panel, tool executor bound to `workspace.fs` and GitLab REST, Web IDE session auth with a PAT fallback |
| `registry/` | Gallery-proxy service. Passes every extension query through to open-vsx.org except this project's own extension, which it serves itself, so a self-hosted GitLab instance's Web IDE marketplace can carry a private extension without abandoning open-vsx for everything else |

Two supporting, non-package directories round out the repo.

`e2e/` holds cross-package flagship tests: a deterministic run against the mock
backend and mock provider, a run against a real Claude model with an in-memory
GitLab, and a live run against a real GitLab instance. The latter two skip
automatically without their required environment variables, so CI stays
deterministic and secret-free by default.

`infra/local-gitlab/` is a Docker Compose GitLab CE instance, loopback-bound,
for integration-style local testing.

For the day-by-day history of what got built, tested, and left open in the
original build session, see `NIGHT-LOG.md` at the repo root. It predates the
GitHub backend and the CLI's current shape, so read it as a build log rather than
a current-state reference. This document and the source are the current state.

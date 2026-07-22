# Architecture and status

werknario proposes changes to your documents as reviewable, auditable diffs.
Git, either GitLab or GitHub, is the document store. A human approves. Every
step is recorded in a tamper-evident, hash-chained audit log. This page draws
a hard line between what runs today and what's planned, and lays out the
monorepo.

## What runs today

Verified end to end, offline, with the mock backend and mock provider: no
credentials, no network.

The CLI (`werknario`, `packages/cli`) drives the whole flow: read the repo,
agent proposes edits, human approves in the terminal, open a merge/pull
request, conflict check, human approves the merge, merge, optional revert
(rollback), all through one process.

Three backends exist: GitLab (REST), GitHub (REST plus the Git Data API for
atomic multi-file commits), and `mock` (in-memory, zero setup). See
[`backends.md`](./backends.md), including the caveat that GitHub's revert is
a simplified tree swap, not a real three-way `git revert`.

Four model providers exist: `mock`, `anthropic`, `bedrock` (AWS, EU inference
profile), and `openai-compatible` (one provider covering Mistral, Kimi,
DeepSeek, Qwen, and self-hosted vLLM-style endpoints). A model registry
carries price, context window, tool-use support, and a data-residency flag
(`eu` / `self-host` / `non-eu`). A deterministic router can pick a cheaper
model for simple steps and a stronger one for sensitive paths. A token ledger
enforces an optional cost budget. Prompt caching is wired for the Anthropic
and Bedrock providers. See
[`providers-and-models.md`](./providers-and-models.md).

A grounding/citation contract limits the agent to what it read this session:
it must cite the file and line span for any factual claim, and a citation to
an unread file or nonexistent lines blocks the merge request or comment
before it's created. See `packages/shared/src/grounding.ts`.

A permission policy (`.werknario/policy.json`) controls which agent may write
which path globs, defaulting to permissive. See
[`permissions.md`](./permissions.md), including the caveat that the
`approvers` field is defined and tested but not yet enforced by anything.

A tamper-evident audit log (`.werknario/audit.jsonl`) is append-only and
hash-chained, verified on load and again at the end of every run. See
[`audit-and-trust.md`](./audit-and-trust.md) for exactly what the hash chain
does and does not protect against.

A VS Code Web IDE extension (`packages/extension`), a standalone LLM proxy
server (`packages/proxy`) for the browser case, and a gallery-proxy registry
service (`registry/`) that lets a self-hosted GitLab instance's Web IDE
install the extension from a custom marketplace, are all built and tested.
The extension's integration tests run in a real headless browser extension
host via `@vscode/test-web`, and the registry has its own unit tests and a
CI-built container image. What isn't up yet is a live, publicly reachable
hosted demo: it needs a DNS record and a Caddy reverse-proxy entry on the
target host before the instance's marketplace can be pointed at it. See
`docs/DISTRIBUTION.md` for the two infrastructure steps still outstanding and
everything already done around them.

## What is not built yet

| Item | Status |
|---|---|
| Supabase operative substrate | Planned, not built |
| Zitadel identity | Planned, not built |
| Cognee memory | Planned, not built |
| Sigstore commit signing | Planned, not built. The audit log is a hash chain today, not a cryptographically signed one (see [`audit-and-trust.md`](./audit-and-trust.md)) |
| Full CI-verify-and-auto-rollback loop | Partially built. The conflict check before merge is real and always runs; further verification (a CI-status probe, for example) is a pluggable hook (`CloseLoopDeps.verify`) with no concrete implementation shipped yet. `rollback()` exists, is audited, and works, but nothing calls it automatically based on a post-merge CI signal — it's offered as an explicit, human-triggered action, not an automatic reaction |
| Live hosted browser demo | Extension, proxy, and registry service are built and tested; reaching them from a real GitLab Web IDE needs DNS and Caddy on the target host (see `docs/DISTRIBUTION.md`) |

## Monorepo layout

| Package | What it does |
|---|---|
| `packages/shared` | Provider-agnostic core: message/tool types, the pure agent loop, the tool executor (grounding, approval gate, path-traversal guard), the audit log, the permission model, the model registry, the token ledger, the deterministic router |
| `packages/gitlab-client` | `fetch`-based GitLab REST client (Node and browser) and the GitLab `ToolBackend` implementation |
| `packages/github-client` | `fetch`-based GitHub REST plus Git Data API client and the GitHub `ToolBackend` implementation |
| `packages/proxy` | Stateless LLM gateway: pluggable providers (mock, anthropic, bedrock, openai-compatible), CORS, bearer auth. Used standalone by the browser extension and in-process (no HTTP) by the CLI |
| `packages/cli` | The `werknario` command: wires a backend, a provider, an audit log, and a policy together, drives the terminal approval flow, closes the loop (merge, revert) |
| `packages/extension` | VS Code web extension for the GitLab Web IDE: webview chat panel, tool executor bound to `workspace.fs` and GitLab REST, Web IDE session auth with a PAT fallback |
| `registry/` | Gallery-proxy service. Passes every extension query through to open-vsx.org except this project's own extension, which it serves itself, so a self-hosted GitLab instance's Web IDE marketplace can carry a private extension without abandoning open-vsx for everything else |

Two supporting, non-package directories round out the repo:

`e2e/` holds cross-package flagship tests: a deterministic run against the
mock backend and mock provider, a run against a real Claude model with an
in-memory GitLab, and a live run against a real GitLab instance. The latter
two skip automatically without their required environment variables, so CI
stays deterministic and secret-free by default.

`infra/local-gitlab/` is a Docker Compose GitLab CE instance, loopback-bound,
for integration-style local testing.

For the day-by-day history of what got built, tested, and left open in the
original build session, see `NIGHT-LOG.md` at the repo root. It predates the
GitHub backend and the CLI's current shape, so read it as a build log rather
than a current-state reference. This document and the source are the current
state.

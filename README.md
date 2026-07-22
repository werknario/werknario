# werknario

An agent that does office paperwork the way a careful colleague would: it reads
your documents, drafts a change, and hands it to a human to approve before
anything is final. Your files live in Git (GitLab or GitHub). An agent here is
software that carries a task through to the end, not just answers.

The point is not that AI writes your documents. Plenty of tools claim that. The
point is the mechanism: every change is a reviewable diff (the exact lines a
change adds and removes), proposed by a named agent and approved by a named
human, and the whole history can be verified rather than trusted.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Node](https://img.shields.io/badge/node-20%2B-informational)
![CI](https://img.shields.io/badge/CI-GitLab%20%2B%20GitHub-informational)

The CI badge is guidance, not a live status: the repo ships pipelines for both
GitLab CI (`.gitlab-ci.yml`) and GitHub Actions (`.github/`). Check your own
run for the current result.

## Try it (one command after install)

No account, no key, no server. The first `npm install` pulls dependencies and
can take a few minutes; the demo itself runs in under a second. It runs the
whole flow against an in-memory repo with a scripted model, so you can see the
shape of it:

```bash
npm install
npm run build
npm run demo
```

`npm run demo` is a small Node launcher, so it behaves the same on Windows
(PowerShell or cmd), macOS, and Linux. Advanced users can drive the CLI
directly instead:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

That inline form is bash syntax. On Windows PowerShell set each variable on its
own line (`$env:LLM_PROVIDER='mock'`); cmd uses `set "LLM_PROVIDER=mock"`. The
`.env` file (copy `.env.example`) avoids the difference.

The demo passes `--yes`, so it auto-approves every write for a hands-off first
look. A real run does the opposite: it pauses for a human `yes` on every write
and on the merge itself.

Real output (abridged). The agent reads a note, proposes a new split-sheet
file, opens a merge request, merges it, and writes an audit log:

```
Note: no policy file at .werknario/policy.json — agent:assistant may write any path. See docs/permissions.md.

werknario · mock/demo (mock)
Task: Draft the split sheet from the session note

Ich lese zuerst die Notiz.
  · read_file
  · propose_edit

  proposal (new file): mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md
    + # Split Sheet — Landgang (ENTWURF)
    + …
  · create_merge_request

Entwurf vorgelegt und Merge Request geöffnet. Bitte die offenen Anteile prüfen.

— 4 model call(s), 5,680 tokens

Merge request opened: mock://merge-request/1
  Merged !1.

Audit: 8 entries at .werknario/audit.jsonl — chain verified.
```

The bundled demo substrate is a German music-label example, so the agent
narrates in German and follows the substrate's language. Point it at your own
repo and the language follows your documents.

With Docker instead (the image puts `werknario` on PATH):

```bash
docker compose run --rm demo
```

Optional, once: `npm link -w @werknario/cli` from the repo root puts `werknario`
on your PATH so you can drop the `node packages/cli/dist/cli.js` prefix.
Everything below uses the source form so it works without that step.

## What runs today, and what does not

| Runs today (built and tested) | Designed, not built yet |
|---|---|
| CLI, full flow: read repo → propose → human approves → open merge/pull request → conflict check → human approves merge → merge → revert | Live **hosted** browser demo — the extension, proxy, and registry are built and tested; what's missing is a DNS record and a Caddy entry on the host so a real GitLab Web IDE can reach them ([docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)) |
| Backends: GitLab, GitHub, and an in-memory mock | Sigstore commit signing (the log is a hash chain today, not a signature) |
| Providers: mock, Anthropic, AWS Bedrock (EU), and one OpenAI-compatible provider for Mistral / Kimi / DeepSeek / Qwen / self-hosted models | A full CI-verify-and-auto-rollback loop (the conflict check runs; `--verify-cmd` and `rollback` exist; nothing yet reverts automatically off a post-merge CI signal) |
| Model registry with prices and a data-residency flag; deterministic model router; token budget; prompt caching | A vector index for retrieval, held behind a measured Recall@k threshold |
| Grounding gate: a citation to a file or line the agent never read hard-blocks the merge request; the number-coverage check is advisory | |
| Path permission policy (which agent may write which path globs) | |
| Tamper-evident, hash-chained audit log (each entry seals the one before it, so any later edit is detectable), plus offline `verify` | |
| The VS Code Web IDE extension, the LLM proxy server, and the gallery-proxy registry service | |

The offline mock path is proven end to end. The GitLab and GitHub paths are
covered by the test suite against their APIs; a live run needs your own repo and
token. See [docs/architecture-and-status.md](docs/architecture-and-status.md)
for the full breakdown.

## Use it for real

Point it at a repo and a model, then give it a task in plain language. It shows
you each diff; you approve each write in the terminal. Both examples below stay
on an EU route by default; a non-EU model is blocked before the first call
unless you set `WERKNARIO_ALLOW_NON_EU=1`. To avoid shell differences, copy
`.env.example` to `.env` (Windows: `copy .env.example .env`), put these values
there, and run the command with no `export` lines.

```bash
# GitLab — EU route: Bedrock in an EU region
export WERKNARIO_BACKEND=gitlab
export GITLAB_BASE_URL=https://gitlab.com
export GITLAB_PROJECT_ID=12345
export GITLAB_TOKEN=...            # scope: api
export LLM_PROVIDER=bedrock
export AWS_REGION=eu-central-1     # an eu- region keeps the route EU; the gate blocks anything else
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...

node packages/cli/dist/cli.js "Summarise the new intake note into the client file"
```

```bash
# GitHub — EU route: Mistral (EU)
export WERKNARIO_BACKEND=github
export GITHUB_REPO=owner/repo
export GITHUB_TOKEN=...            # scope: contents + pull requests
export LLM_PROVIDER=openai-compatible
export LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1
export LLM_OPENAI_COMPAT_API_KEY=...
export LLM_MODEL=mistral-large-3

node packages/cli/dist/cli.js "Draft a reply to the latest issue in docs/"
```

Add `--yes` to run unattended, `--dry-run` to preview without opening anything,
`--route` to let it pick a cheaper model for simple steps, `--budget 5` to stop
once a run costs five dollars, and `--verify-cmd <cmd>` to run your own check
before a merge. More tasks in [docs/recipes.md](docs/recipes.md); full reference
in [docs/configuration.md](docs/configuration.md). New here? Start with
[docs/getting-started.md](docs/getting-started.md).

## Why not just point Aider or OpenHands at a docs repo?

A coding agent will happily edit files and open a pull request. The difference
is what stands between the model and a merged change, and whether you can check
it afterwards instead of trusting it.

- **A citation gate runs before the merge request exists.** If the agent claims
  something and cites a file or line it never read this session, the proposal is
  blocked before anything is opened. A generic coding agent has no such gate;
  a confident fabrication becomes a diff.
- **A path permission policy decides which paths the agent may write.**
  `.werknario/policy.json` scopes an agent to path globs, so a task about one
  folder cannot rewrite the whole repo.
- **The approver is a human reading a diff, not code.** Every write and the
  merge itself pause for a human `yes` in the terminal, so a non-developer can
  hold the gate. Holding it in the terminal still means running the CLI, so a
  non-technical approver works from the VS Code Web IDE extension surface
  instead. The policy also carries a named-approver role; that role is defined
  and tested but not yet enforced by the gate, so read it as design, not a
  control.
- **The log is offline-verifiable.** Every step is a hash-chained entry;
  `node packages/cli/dist/cli.js verify .werknario/audit.jsonl` exits non-zero
  if the chain breaks. It is a hash chain, not a signature: it detects edits,
  reordering, and insertions after the fact, and the chain head is stamped into
  the merge request so the Git server anchors it against tail truncation.
- **The router refuses to send personal data to a non-EU model, and now
  enforces it.** Before any model call the CLI resolves the route's residency:
  `mock` is local and exempt, Bedrock counts as EU only in an `eu-` region
  (`AWS_REGION=eu-central-1`), the direct Anthropic API is a US route and so
  non-EU, and openai-compatible models follow the registry (Mistral and the
  self-hosted or OVHcloud entries are EU; Kimi and DeepSeek direct are not).
  Anything unrecognised is treated as `non-eu`, so the failure is safe. A
  non-EU route is blocked with a clear message before the model is called; set
  `WERKNARIO_ALLOW_NON_EU=1` to override, which prints a warning and proceeds,
  and only for data that carries no personal information.

## Install

- **Docker**: `docker build -t werknario .`, then
  `docker run --rm -e LLM_PROVIDER=mock -e WERKNARIO_BACKEND=mock werknario "your task" --yes`.
  Configuration via `.env` (copy `.env.example`).
- **From source**: Node 20+, `npm install && npm run build`. The CLI is a
  bundled file at `packages/cli/dist/cli.js`.

Self-hosting the whole stack is documented in
[docs/self-hosting.md](docs/self-hosting.md).

## How it is put together

A small TypeScript monorepo. Everything the agent can do sits behind a narrow
interface, so a backend or a model is a swap, not a rewrite.

| Package | What it is |
|---|---|
| `packages/shared` | The pure core: agent loop, tool schemas, grounding gate, path guard, token ledger, model registry, deterministic router, permission model, audit log. No I/O, heavily tested. |
| `packages/gitlab-client` | GitLab REST backend (read, propose, branch, commit, merge request, merge, revert). |
| `packages/github-client` | GitHub REST backend, same shape, atomic multi-file commits via the Git Data API. |
| `packages/proxy` | LLM gateway: the providers (mock / anthropic / bedrock / openai-compatible) and the config loader. |
| `packages/cli` | The `werknario` command: wires a backend, a provider, the audit log, a policy, and terminal approvals. |
| `packages/extension` | The VS Code Web IDE extension, a second surface for GitLab's browser IDE. |
| `registry/` | Gallery-proxy so a self-hosted GitLab marketplace can carry the extension. |

## Documentation

**Start here**
[getting-started](docs/getting-started.md) ·
[DEMO](docs/DEMO.md)

**Run it**
[configuration](docs/configuration.md) ·
[backends](docs/backends.md) ·
[providers and models](docs/providers-and-models.md) ·
[recipes](docs/recipes.md) ·
[self-hosting](docs/self-hosting.md)

**How it works and why to trust it**
[architecture and status](docs/architecture-and-status.md) ·
[audit and trust](docs/audit-and-trust.md) ·
[grounding](docs/grounding.md) ·
[permissions](docs/permissions.md) ·
[LLM communication](docs/llm-communication.md) ·
[Compliance (DE)](docs/de/compliance.md)

**Ship and troubleshoot**
[distribution](docs/DISTRIBUTION.md) ·
[troubleshooting](docs/troubleshooting.md) ·
[FAQ](docs/faq.md)

**Project**
[CONTRIBUTING](CONTRIBUTING.md) ·
[GOVERNANCE](GOVERNANCE.md) ·
[CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) ·
[SECURITY](SECURITY.md) ·
[ADAPTERS](ADAPTERS.md)

## License

Apache License 2.0. See [LICENSE](LICENSE). Security and conduct contact:
jonah@grosshanten.com.

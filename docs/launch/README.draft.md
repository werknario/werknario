> Draft. This is a proposed replacement for the README head and top-level
> structure, not the live `README.md`. Nothing here overwrites the real file.
> It resolves the README-vs-status contradiction in favour of
> [docs/architecture-and-status.md](../architecture-and-status.md): the
> extension, proxy, and registry are built and tested; the only piece not yet
> live is the publicly reachable hosted demo (a DNS record and a Caddy entry on
> the host). It also unifies the invocation so every command in the README uses
> the same `werknario` form.
>
> One placeholder needs filling before publish: `OWNER` in the CI badge URL is
> the GitHub org/user of the public repo (marketing sets the public repo name to
> `werknario`). Show the CI badge only once the GitHub Actions pipeline is
> reliably green.

# werknario

An agent that does office paperwork the way a careful colleague would: it reads
your documents, drafts a change, and hands it to a human to approve before
anything is final. Your files live in Git (GitLab or GitHub). An agent here is
software that carries a task through to the end, not just answers.

Every change is a reviewable diff, proposed by a named agent and approved by a
named human, and the whole history can be verified rather than trusted.

The point is not that an agent writes your documents. Plenty of tools claim
that. The point is the mechanism: a citation to a file the agent never read
blocks the merge request before a human ever sees it, and `werknario verify`
checks the whole log with an exit code instead of a promise. You can watch both
in an offline demo with no key and no server.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/OWNER/werknario/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/werknario/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-20%2B-informational)

## Watch it run (30 seconds)

<!--
  DEMO CAST PLACEHOLDER

  Drop the recorded asset here once it exists. Two frames carry the point:
  a fabricated citation blocks the merge request, then `werknario verify`
  turns the chain green (exit 0).

  - GitHub README: an inline GIF or animated SVG (svg-term or agg), committed
    into the repo (e.g. docs/launch/demo.svg), never an external host and never
    an asciinema player (it does not autoplay inline on GitHub).
  - Terminal-native channels: the real .cast for asciinema.org.
  - Reddit / Lobsters: a single static title frame (blocked fabricated diff
    next to the green verify chain), since no terminal autoplay runs there.

  Until the asset lands:
    ![werknario demo](docs/launch/demo.svg)
-->

_Recorded demo goes here (see the comment above)._

## Try it (one command)

No account, no key, no server. The image puts `werknario` on your PATH and runs
the whole flow against an in-memory repo with a scripted model, so you see the
shape of it end to end:

```bash
docker compose run --rm demo
```

The first run builds the image; the flow itself runs in under a second. It reads
a note, proposes a new split-sheet file, opens a merge request, merges it, and
writes an audit log. Abridged output:

```
werknario · mock/demo (mock)
Task: Draft the split sheet from the session note

Ich lese zuerst die Notiz.
  · read_file
  · propose_edit

  proposal (new file): mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md
    + # Split Sheet — Landgang (ENTWURF)
    + …
  · create_merge_request

Merge request opened: mock://merge-request/1
  Merged !1.

Audit: 9 entries at .werknario/audit.jsonl — chain verified.
```

The bundled demo substrate is a German-language music-label example, so the
agent narrates in German and follows the substrate's language. Point it at your
own repo and the language follows your documents. The demo auto-approves every
write for a hands-off first look; a real run pauses for a human `yes` on every
write and on the merge itself.

## Install

- **Docker**: `docker build -t werknario .`, then
  `docker run --rm -e LLM_PROVIDER=mock -e WERKNARIO_BACKEND=mock werknario "your task" --yes`.
  The image already has `werknario` on PATH. Configure via `.env` (copy `.env.example`).
- **From source**: Node 20+.

  ```bash
  npm install
  npm run build
  npm link -w @werknario/cli   # once: puts werknario on your PATH
  ```

  Every command below uses the short `werknario` form, which the `npm link` step
  above provides. Without linking, the CLI is a bundled file you can call
  directly: `node packages/cli/dist/cli.js <args>`. The two are the same binary.

Self-hosting the whole stack is documented in
[docs/self-hosting.md](../self-hosting.md).

## Why not just point Aider or OpenHands at a docs repo?

You can. A coding agent will edit files and open a pull request. The difference
is what stands between the model and a merged change, and whether you can check
it afterwards instead of trusting it. werknario adds what a documents workflow
needs and a code workflow does not:

- **A citation gate runs before the merge request exists.** If the agent claims
  something and cites a file or line it never read this session, the proposal is
  blocked before anything is opened, and the agent is told to read the source and
  correct the citation. A generic coding agent has no such gate; a confident
  fabrication becomes a diff. (Origin is a hard block. The separate
  number-coverage check is advisory, not a block; see
  [docs/grounding.md](../grounding.md).)
- **A path permission policy controls which paths the agent may write.**
  `.werknario/policy.json` scopes an agent to path globs, so a task about one
  folder cannot rewrite the whole repo.
- **The approver is a human reading a diff, not code.** Every write and the merge
  itself pause for a human `yes`. For a GitLab or GitHub backend the CLI binds
  that approval to the authenticated token holder (`GET /user`), not a name typed
  on the command line. Org-wide enforcement across every surface (the VS Code Web
  IDE extension, single sign-on) is on the roadmap; see
  [docs/permissions.md](../permissions.md).
- **The log is offline-verifiable.** Every step is a hash-chained entry;
  `werknario verify .werknario/audit.jsonl` exits non-zero if the chain breaks.
  It is a hash chain, not a signature: it makes middle-of-chain edits,
  reordering, and insertions detectable, and the chain head is stamped into the
  merge request so the Git server anchors it against tail truncation. Optional
  Ed25519 signing (`keygen`, then `verify --pubkey`) adds who-produced-it on top,
  opt-in.
- **The router refuses to send personal data to a non-EU model by default.**
  Before any model call the CLI resolves the route's residency and blocks a
  non-EU route with a clear message; set `WERKNARIO_ALLOW_NON_EU=1` to override
  for data that carries no personal information. See
  [docs/providers-and-models.md](../providers-and-models.md).

## What runs today, and what does not

The built column is the product. The designed column is the honest edge, and
each row carries the real reason it is where it is.

| Runs today (built and tested) | Designed, not built yet |
|---|---|
| CLI, full supervised flow: read repo → propose → human approves → open merge/pull request → conflict check → human approves merge → merge → human-triggered revert | Live **hosted** browser demo. The extension, proxy, and registry are built and tested; what is missing is a DNS record and a Caddy entry on the host so a real GitLab Web IDE can reach them ([docs/DISTRIBUTION.md](../DISTRIBUTION.md)) |
| Backends: GitLab, GitHub, and an in-memory mock (GitHub revert is a simplified tree swap, not a three-way `git revert`) | Full CI-verify-and-auto-rollback loop. The conflict check runs, `--verify-cmd` and `rollback` exist, but nothing reverts automatically off a post-merge CI signal; rollback is an explicit, human-triggered action |
| Providers: mock, Anthropic, AWS Bedrock (EU), and one OpenAI-compatible provider for Mistral / Kimi / DeepSeek / Qwen / self-hosted models | Keyless Sigstore with a public transparency log (Rekor). Optional self-hosted Ed25519 signing of the log is built; the keyless route adds third-party timestamping and stays on the roadmap |
| Model registry with prices and a data-residency flag; deterministic model router; token budget; prompt caching (Anthropic, Bedrock) | Vector index for retrieval, held behind a measured Recall@k threshold. Retrieval today runs on keyword search over a Git-native decision log |
| Grounding gate: a citation to a file or line the agent never read hard-blocks the merge request; the number-coverage check is advisory | Org-wide approver enforcement across surfaces (SSO). The CLI already binds merge approval to the authenticated token holder; the extension surface does not yet run the same check |
| Path permission policy: which agent may write which path globs | |
| Tamper-evident, hash-chained audit log with offline `verify`; optional opt-in Ed25519 signing (`keygen` / `verify --pubkey`) | |
| The VS Code Web IDE extension, the LLM proxy server, and the gallery-proxy registry service | |

The offline mock path is proven end to end. The GitLab and GitHub paths are
covered by the test suite against their APIs; a live run needs your own repo and
token. See [docs/architecture-and-status.md](../architecture-and-status.md) for
the full breakdown, which this table follows.

## Use it for real

Point it at a repo and a model, then give it a task in plain language. It shows
you each diff; you approve each write in the terminal. Both routes below stay in
the EU by default; a non-EU model is blocked before the first call unless you set
`WERKNARIO_ALLOW_NON_EU=1`. To avoid shell differences, copy `.env.example` to
`.env` and put these values there.

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

werknario "Summarise the new intake note into the client file"
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

werknario "Draft a reply to the latest issue in docs/"
```

Add `--yes` to run unattended, `--dry-run` to preview without opening anything,
`--route` to let it pick a cheaper model for simple steps, `--budget 5` to stop
once a run costs five dollars, and `--verify-cmd <cmd>` to run your own check
before a merge. Verify a past run's log on its own with
`werknario verify .werknario/audit.jsonl`. More tasks in
[docs/recipes.md](../recipes.md); full reference in
[docs/configuration.md](../configuration.md). New here? Start with
[docs/getting-started.md](../getting-started.md).

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

Adding a model, a provider, or a backend is a small, predictable change. A new
model is one entry in `packages/shared/src/models.ts` plus a test. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Documentation

**Start here**
[getting-started](../getting-started.md) ·
[DEMO](../DEMO.md)

**Run it**
[configuration](../configuration.md) ·
[backends](../backends.md) ·
[providers and models](../providers-and-models.md) ·
[recipes](../recipes.md) ·
[self-hosting](../self-hosting.md)

**How it works and why to check it**
[architecture and status](../architecture-and-status.md) ·
[audit and trust](../audit-and-trust.md) ·
[grounding](../grounding.md) ·
[permissions](../permissions.md) ·
[LLM communication](../llm-communication.md)

**Ship and troubleshoot**
[distribution](../DISTRIBUTION.md) ·
[troubleshooting](../troubleshooting.md) ·
[FAQ](../faq.md)

**Project**
[CONTRIBUTING](../../CONTRIBUTING.md) ·
[GOVERNANCE](../../GOVERNANCE.md) ·
[CODE_OF_CONDUCT](../../CODE_OF_CONDUCT.md) ·
[SECURITY](../../SECURITY.md) ·
[ADAPTERS](../../ADAPTERS.md)

## License

Apache License 2.0. See [LICENSE](../../LICENSE). Security and conduct contact:
jonah@grosshanten.com.

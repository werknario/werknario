# werknario

An agent that does office paperwork the way a good colleague would: it reads your
documents, drafts a change, and hands it to a human to approve before anything is
final. Your files live in Git (GitLab or GitHub). Every step, from the first draft
to the final merge, is written to a tamper-evident log.

The point is not "AI writes your documents." Plenty of tools claim that. The point
is that every change is a reviewable diff, proposed by a named agent and approved
by a named human, and that the whole history can be verified rather than trusted.

## Try it in 30 seconds

No account, no key, no server. This runs the whole flow against an in-memory repo
with a scripted model, so you can see the shape of it:

```bash
npm install
npm run build
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

You will see the agent read a note, propose a new file, "open" a merge request,
merge it, and write an audit log:

```
werknario · mock/demo (mock)
Task: Draft the split sheet from the session note

  · read_file
  · propose_edit
  · create_merge_request
Merge request opened: mock://merge-request/1
  Merged !1.

Audit: 8 entries at .werknario/audit.jsonl — chain verified.
```

With Docker instead:

```bash
docker compose run --rm demo
```

## What runs today, and what does not

This project keeps an honest line between what is built and what is designed.

| Runs today (built and tested) | Designed, not built yet |
|---|---|
| CLI: read repo → propose → human approves → open merge/pull request → conflict check → human approves merge → merge → revert | VS Code Web IDE extension distribution + a hosted demo |
| Backends: GitLab, GitHub, and an in-memory mock | Supabase operative store, Zitadel identity, Cognee memory |
| Providers: mock, Anthropic, AWS Bedrock (EU), and one OpenAI-compatible provider for Mistral / Kimi / DeepSeek / Qwen / self-hosted models | Sigstore commit signing |
| Model registry with prices + a data-residency flag, a deterministic model router, a token budget, prompt caching | A full CI-verify-and-auto-rollback loop |
| Citation contract: the agent may only claim what it read, with file and line; a fabricated citation blocks the merge request | |
| Permission policy (who may write which paths, who may approve) | |
| Tamper-evident, hash-chained audit log | |

The offline mock path is proven end to end. The GitLab and GitHub paths are covered
by unit tests against their APIs; a live run needs your own repo and token.
Verification beyond the conflict check is a pluggable hook, and automatic
post-merge rollback needs a CI signal, so it is offered as an explicit action
rather than pretended. See [docs/architecture-and-status.md](docs/architecture-and-status.md).

## Use it for real

Point it at a repo and a model, then give it a task in plain language.

```bash
# GitLab
export WERKNARIO_BACKEND=gitlab
export GITLAB_BASE_URL=https://gitlab.com
export GITLAB_PROJECT_ID=12345
export GITLAB_TOKEN=...            # scope: api
export LLM_PROVIDER=anthropic
export CLAUDE_API_TOKEN=...

node packages/cli/dist/cli.js "Summarise the new intake note into the client file"
```

```bash
# GitHub
export WERKNARIO_BACKEND=github
export GITHUB_REPO=owner/repo
export GITHUB_TOKEN=...            # scope: contents + pull requests
export LLM_PROVIDER=openai-compatible
export LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1
export LLM_OPENAI_COMPAT_API_KEY=...
export LLM_MODEL=mistral-large-3

node packages/cli/dist/cli.js "Draft a reply to the latest issue in docs/"
```

The agent proposes and shows you the diff; you approve each write in the terminal.
Add `--yes` to run it unattended, `--route` to let it pick a cheaper model for
simple steps, and `--budget 5` to stop it once a run costs five dollars. Full
reference in [docs/configuration.md](docs/configuration.md).

## The audit trail

Every run appends to `.werknario/audit.jsonl`. Each entry records who acted (a
named agent or a named human), what they did, and the details, and it carries the
hash of the entry before it. Change, delete, reorder, or insert an entry after the
fact and the chain stops verifying. The tool checks the chain every time it starts
and refuses to append to a log that was tampered with.

```json
{"seq":2,"actor":"human:anna","action":"approve","detail":{"tool":"create_merge_request"},"prevHash":"7940…","hash":"c0c7…"}
{"seq":3,"actor":"agent:assistant","action":"create_merge_request","detail":{"iid":1,"title":"Split Sheet"},"prevHash":"c0c7…","hash":"ef18…"}
```

Check a log at any time, without a full run:

```bash
werknario verify .werknario/audit.jsonl   # exits non-zero if the chain is broken
```

Each merge request also carries the chain head in its description, so the git
server anchors the log against being shortened after the fact. This is the
difference between "an agent changed this document and a human approved it" as a
claim and as something you can check. More in
[docs/audit-and-trust.md](docs/audit-and-trust.md).

## Data residency and models

Because it runs on documents that may contain personal data, the model registry
carries a data-residency flag for each model: `eu`, `self-host`, or `non-eu`. The
router refuses a policy that would send personal data to a model without EU
residency. Anthropic via AWS Bedrock EU and Mistral (an EU company, Apache-2.0
weights) are the straightforward EU paths; Kimi, DeepSeek, and Qwen are only
GDPR-safe self-hosted or through an EU host. See
[docs/providers-and-models.md](docs/providers-and-models.md).

## Install

- **Docker**: `docker build -t werknario .` then
  `docker run --rm -e LLM_PROVIDER=mock -e WERKNARIO_BACKEND=mock werknario "your task" --yes`.
  Configuration via `.env` (copy `.env.example`). See [docs/configuration.md](docs/configuration.md).
- **From source**: Node 20+, `npm install && npm run build`. The CLI is a single
  bundled file at `packages/cli/dist/cli.js`.

## How it is put together

A small TypeScript monorepo. Everything the agent can do is behind a narrow
interface, so a backend or a model is a swap, not a rewrite.

| Package | What it is |
|---|---|
| `packages/shared` | The pure core: agent loop, tool schemas, the citation contract, the token account, the model router, the permission model, the audit log. No I/O, heavily unit-tested. |
| `packages/gitlab-client` | GitLab REST backend (read, propose, branch, commit, merge request, merge, revert). |
| `packages/github-client` | GitHub REST backend, same shape, atomic multi-file commits via the Git Data API. |
| `packages/proxy` | Model gateway: the providers (mock / anthropic / bedrock / openai-compatible) and the config loader. |
| `packages/cli` | The `werknario` command: wires a backend, a provider, the audit log, and terminal approvals. |
| `packages/extension` | The VS Code Web IDE extension (a second surface, for GitLab's browser IDE). |

Details in [docs/architecture-and-status.md](docs/architecture-and-status.md).

## Contributing

Contributions are welcome. The build is `npm install`, tests are `npm test`, and
new code is written test-first with tests in each package's `test/`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).

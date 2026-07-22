# Adapters

werknario has two adapter seams. Both are provider-agnostic interfaces in
`packages/shared`, so adding a new one is a new entry, not a rewrite of the
agent.

- A **backend** (`ToolBackend`, `packages/shared/src/executor.ts`) is where the
  work lives: it lists and reads files, stages a proposed edit as a diff, and
  opens a merge or pull request. Selected by `WERKNARIO_BACKEND`.
- A **provider** (`Provider`, `packages/proxy/src/providers/index.ts`) is one
  model turn in, one model turn out. No agent-loop state lives here. Selected by
  `LLM_PROVIDER`.

A **model** is a third, lighter thing: a catalog row in
`packages/shared/src/models.ts` carrying price, context window, tool-use
support, and a data-residency flag. Adding a model that speaks an existing
provider's protocol is a catalog entry, not a new adapter. See
[docs/providers-and-models.md](docs/providers-and-models.md).

The spine holds across every combination: every change is a reviewable diff,
proposed by a named agent and approved by a named human, and the whole history
can be verified rather than trusted.

## Backends (built and tested)

`WERKNARIO_BACKEND` picks one of these. All three are built and covered by the
test suite.

| `WERKNARIO_BACKEND` | Package | What it talks to | Notes |
|---|---|---|---|
| `gitlab` | `packages/gitlab-client` | A GitLab instance (self-hosted or gitlab.com) over the REST API | Default when `GITHUB_REPO` is unset. Needs `GITLAB_BASE_URL`, `GITLAB_PROJECT_ID`, `GITLAB_TOKEN` (scope `api`). |
| `github` | `packages/github-client` | GitHub, via the REST and Git Data APIs | Needs `GITHUB_REPO=owner/repo`, `GITHUB_TOKEN` (scope `contents` + `pull requests`). Revert here is a simplified tree swap, not a three-way git revert: any unrelated changes made after the reverted commit landed are reverted too. |
| `mock` | `packages/cli/src/mockBackend.ts` | An in-memory substrate, no network | Drives the full flow deterministically for the offline demo and unit tests. Merge requests come back as `mock://merge-request/<n>`. |

The offline demo runs entirely on `mock` for both seams, no key and no server:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

The bundled demo substrate is a German-language music-label example, so the
agent narrates in German; it follows whatever language the substrate is in.
Point it at your own repo for English. What each backend seeds and how to wire a
real one is in [docs/backends.md](docs/backends.md).

## Providers (built and tested)

`LLM_PROVIDER` picks one of these. All four are built and live in
`packages/proxy/src/providers/`.

| `LLM_PROVIDER` | File | What it reaches | Notes |
|---|---|---|---|
| `mock` | `mock.ts` | Nothing | Scripted, deterministic responses for the offline demo and tests. |
| `anthropic` | `anthropic.ts` | Claude via the Anthropic API | Needs `CLAUDE_API_TOKEN` (or `ANTHROPIC_API_KEY`). |
| `bedrock` | `bedrock.ts` | Claude via AWS Bedrock, EU inference profile | Needs `AWS_REGION` and AWS credentials. The EU route carries a data-residency flag in the model registry. |
| `openai-compatible` | `openai-compatible.ts` | Any endpoint that speaks the OpenAI chat protocol | One adapter, many endpoints: Mistral (La Plateforme), self-hosted vLLM, DeepSeek, Kimi, Qwen, OVHcloud AI Endpoints. Needs `LLM_OPENAI_COMPAT_BASE_URL`, `LLM_OPENAI_COMPAT_API_KEY`, `LLM_MODEL`. |

Because `openai-compatible` is protocol-based, most new models are reached by
pointing it at a different base URL and adding a registry row, not by writing a
provider. The registry already carries EU, self-host, and non-EU entries with
their prices and residency flags. Full env reference:
[docs/providers-and-models.md](docs/providers-and-models.md).

## Wanted (not built yet)

These do not exist in the repo today. They are the adapters a contribution would
be welcome for. Treat every row as a proposal, not a shipped feature.

| Kind | Idea | Why it fits |
|---|---|---|
| Backend | Gitea / Forgejo | Self-hosted, popular in the DACH region, has a merge-request and REST model close enough to the existing `ToolBackend` shape. |
| Backend | Bitbucket (Cloud or Data Center) | Rounds out the third major forge alongside GitLab and GitHub. |
| Backend | Plain Git / local filesystem | A backend that proposes edits against a working tree with no forge, for offline or air-gapped use. |
| Provider | Google Vertex (Gemini, or Claude on Vertex) | A second EU-region route besides Bedrock, with its own residency flag. |
| Provider preset | More `openai-compatible` model rows | Verified price and data-residency entries in `models.ts` for endpoints not yet cataloged. Often a catalog PR, not a code PR. |

If you build one of these, or something else that implements `ToolBackend` or
`Provider`, [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, test, and build
steps. The existing adapters are the reference shape: a new backend implements
the four methods on `ToolBackend`; a new provider implements the single
`createMessage` on `Provider`; a new model is a row in `models.ts` with a
verified price and residency flag. New behavior gets a failing test before the
code that makes it pass.

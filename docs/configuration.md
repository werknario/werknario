# Configuration

werknario reads configuration from environment variables and, for the CLI, a
handful of flags. Secrets (tokens, API keys) always come from the environment,
never from a flag, so they don't land in shell history. This page lists every
variable and flag actually read by the source, grouped the way the code
groups them: backend, identity, run options, and model provider.

Sources: `packages/cli/src/config.ts` (CLI) and `packages/proxy/src/config.ts`
(model provider, read by both the CLI in-process and the standalone proxy
server used by the browser extension).

## CLI flags

```
werknario "your task in plain language" [options]
```

| Flag | Takes a value | Env equivalent | Default | What it does |
|---|---|---|---|---|
| `--yes` | no | `WERKNARIO_AUTO_APPROVE=1` | off | Approve every write automatically (unattended run) |
| `--route` | no | `WERKNARIO_ROUTE=1` | off | Let the deterministic router pick a cheaper model for simple turns |
| `--budget <usd>` | yes | `WERKNARIO_BUDGET_USD` | none | Stop the run once its cost reaches this many USD |
| `--de` | no | `WERKNARIO_LOCALE=de` | `en` | German for the agent's prompt and the CLI's messages (see note below) |
| `--agent <id>` | yes | `WERKNARIO_AGENT_ID` | `agent:assistant` | Audit-log actor for the agent (an `agent:` prefix is added if omitted) |
| `--human <name>` | yes | `WERKNARIO_HUMAN` | `human:you` | Audit-log actor for the approving human (a `human:` prefix is added if omitted) |
| `--audit <path>` | yes | `WERKNARIO_AUDIT` | `.werknario/audit.jsonl` | Audit log file |
| `--policy <path>` | yes | `WERKNARIO_POLICY` | `.werknario/policy.json` | Permission file |
| `--max-turns <n>` | yes | none | 12 | Cap the number of model turns for this run |

Everything else on the command line is joined into the task string.

Locale note: the CLI defaults to English and the Web IDE extension uses German.
`--de` / `WERKNARIO_LOCALE=de` switches the CLI to German for both the agent's
system prompt (`packages/shared/src/prompt.ts` carries an English and a German
version) and the CLI's own outcome messages (merge conflict, auth failure, and so
on; `packages/shared/src/friendlyError.ts`). The `[Beleg: …]` citation tag stays
identical in both languages, because the grounding checker matches it literally.

## Backend

`WERKNARIO_BACKEND` selects `gitlab`, `github`, or `mock`. If unset, it
defaults to `github` when `GITHUB_REPO` is set, otherwise `gitlab`. `mock` is
never picked implicitly; you have to ask for it.

### GitLab (`WERKNARIO_BACKEND=gitlab`, the default)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GITLAB_TOKEN` | yes* | — | Personal/project access token, `api` scope |
| `GITLAB_PAT` | yes* | — | Alternate name for the same token; `GITLAB_TOKEN` wins if both are set |
| `GITLAB_PROJECT_ID` | yes | — | Numeric project ID or URL-encoded `group/project` path |
| `GITLAB_BASE_URL` | no | `https://gitlab.com` | Your self-hosted instance URL |

\* one of `GITLAB_TOKEN` / `GITLAB_PAT` is required.

### GitHub (`WERKNARIO_BACKEND=github`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | See [`backends.md`](./backends.md) for scope details |
| `GITHUB_REPO` | yes | — | `owner/repo` |
| `GITHUB_API_URL` | no | `https://api.github.com` | For GitHub Enterprise Server |

### mock (`WERKNARIO_BACKEND=mock`)

No variables needed. In-memory, seeded with one demo file. See
[`backends.md`](./backends.md).

## Identity

| Variable | Default | Notes |
|---|---|---|
| `WERKNARIO_AGENT_ID` | `agent:assistant` | Audit-log actor for the agent. A leading `agent:` prefix is stripped before matching against `.werknario/policy.json` |
| `WERKNARIO_HUMAN` | `human:you` | Audit-log actor for the human approving the run |

Set identity through the environment variables above, or per run with the
`--agent <id>` and `--human <name>` flags. A missing `agent:` / `human:` prefix
is added for you, and a flag wins over the matching environment variable.

## Run options

| Variable | CLI flag | Default | Notes |
|---|---|---|---|
| `WERKNARIO_AUTO_APPROVE` | `--yes` | unset | `"1"` to auto-approve |
| `WERKNARIO_ROUTE` | `--route` | unset | `"1"` to enable model routing |
| `WERKNARIO_LOCALE` | `--de` | `en` | `"de"` for German CLI messages |
| `WERKNARIO_AUDIT` | `--audit <path>` | `.werknario/audit.jsonl` | |
| `WERKNARIO_POLICY` | `--policy <path>` | `.werknario/policy.json` | |
| `WERKNARIO_BUDGET_USD` | `--budget <usd>` | unset | soft cost ceiling for the run |

## Model provider

`LLM_PROVIDER` selects `mock`, `anthropic`, `bedrock`, or `openai-compatible`.
Unset or unrecognized values fall back to `mock`. `LLM_MODEL` sets the model
id passed to the provider (default `claude-sonnet-5`).

| Variable | Applies to | Default | Notes |
|---|---|---|---|
| `LLM_PROVIDER` | all | `mock` | `mock` \| `anthropic` \| `bedrock` \| `openai-compatible` |
| `LLM_MODEL` | all | `claude-sonnet-5` | Canonical id or the provider's own raw model id |
| `CLAUDE_API_TOKEN` | anthropic | — | Read first; falls back to `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | anthropic | — | Fallback if `CLAUDE_API_TOKEN` is unset |
| `AWS_REGION` | bedrock | — | Passed to the Bedrock client |
| `AWS_ACCESS_KEY_ID` | bedrock | — | Read into config, but the Bedrock SDK resolves AWS credentials through its own standard chain, so set this (and `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`) as normal AWS environment variables |
| `AWS_SECRET_ACCESS_KEY` | bedrock | — | See above |
| `LLM_OPENAI_COMPAT_BASE_URL` | openai-compatible | — | e.g. `https://api.mistral.ai/v1` |
| `LLM_OPENAI_COMPAT_API_KEY` | openai-compatible | — | Sent as `Authorization: Bearer <key>` |

For the `bedrock` provider, `@anthropic-ai/bedrock-sdk` is an optional
dependency. It is not installed by default so that `mock` and `anthropic`
keep working without it. Install it and set `LLM_PROVIDER=bedrock` to use it;
see [`providers-and-models.md`](./providers-and-models.md).

### Proxy server only (not needed for CLI use)

The CLI calls the provider in-process and never starts or talks to an HTTP
server. These variables only matter if you run `packages/proxy` standalone,
which is the setup the browser extension needs since a browser cannot hold
AWS or Anthropic credentials:

| Variable | Default | Notes |
|---|---|---|
| `PROXY_BEARER_TOKEN` | — | Token the extension must present; unset rejects every request |
| `PROXY_PORT` | `9109` | |
| `PROXY_ALLOWED_ORIGINS` | `*` | Comma-separated origins, or `*` |

## Examples

Offline, no keys, no server:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  werknario "Draft the split sheet from the session note" --yes
```

GitLab + Anthropic direct:

```bash
WERKNARIO_BACKEND=gitlab \
GITLAB_BASE_URL=https://gitlab.example.com \
GITLAB_PROJECT_ID=42 \
GITLAB_TOKEN=glpat-xxx \
LLM_PROVIDER=anthropic \
CLAUDE_API_TOKEN=sk-ant-xxx \
  werknario "Summarize the open issues under docs/"
```

GitLab + Bedrock EU:

```bash
WERKNARIO_BACKEND=gitlab \
GITLAB_PROJECT_ID=42 GITLAB_TOKEN=glpat-xxx \
LLM_PROVIDER=bedrock LLM_MODEL=eu.anthropic.claude-sonnet-5-... \
AWS_REGION=eu-central-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  werknario "..." --route --budget 2
```

GitHub + an OpenAI-compatible endpoint (Mistral):

```bash
WERKNARIO_BACKEND=github \
GITHUB_REPO=my-org/my-docs GITHUB_TOKEN=ghp_xxx \
LLM_PROVIDER=openai-compatible \
LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1 \
LLM_OPENAI_COMPAT_API_KEY=... LLM_MODEL=mistral-large-3 \
  werknario "..."
```

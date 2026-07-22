# Configuration

werknario reads its configuration from environment variables and, for the CLI, a
handful of command-line flags. Secrets (tokens, API keys) always come from the
environment, never from a flag, so they do not land in shell history. This page
lists every variable and flag actually read by the source, grouped the way the
code groups them: backend, identity, run options, model provider, and the two
state files the run reads and writes.

Sources of truth: `packages/cli/src/config.ts` (CLI backend, identity, run
options) and `packages/proxy/src/config.ts` (the model provider, read both by the
CLI in-process and by the standalone proxy server the browser extension talks to).

New here? Start with [getting-started.md](getting-started.md); this page is the
reference you come back to.

## How you invoke the CLI

After a source build (`npm install` then `npm run build`, Node 20+) the CLI is a
built file, not a command on your PATH. Every runnable example below uses the
form that works right after a build:

```bash
node packages/cli/dist/cli.js "your task in plain language" [options]
```

If you prefer the short `werknario` command, link it once:

```bash
cd packages/cli && npm link
werknario "your task in plain language" [options]
```

The Docker image puts `werknario` on PATH already, so the Docker path uses the
short form. Pick one form per sequence and stay with it; do not mix them.

## CLI flags

| Flag | Takes a value | Env equivalent | Default | What it does |
|---|---|---|---|---|
| `--yes` | no | `WERKNARIO_AUTO_APPROVE=1` | off | Approve every write automatically (unattended run) |
| `--dry-run` | no | `WERKNARIO_DRY_RUN=1` | off | Propose and show the diff, but decline every team-visible write |
| `--route` | no | `WERKNARIO_ROUTE=1` | off | Let the deterministic router pick a cheaper model for simple turns |
| `--verify-cmd <cmd>` | yes | `WERKNARIO_VERIFY_CMD` | none | Shell command run before a merge; a non-zero exit blocks the merge |
| `--budget <usd>` | yes | `WERKNARIO_BUDGET_USD` | none | Stop the run once its accumulated cost reaches this many USD |
| `--de` | no | `WERKNARIO_LOCALE=de` | `en` | German for the agent's prompt and the CLI's messages (see note below) |
| `--agent <id>` | yes | `WERKNARIO_AGENT_ID` | `agent:assistant` | Audit-log actor for the agent (an `agent:` prefix is added if you omit it) |
| `--human <name>` | yes | `WERKNARIO_HUMAN` | `human:you` | Audit-log actor for the approving human (a `human:` prefix is added if omitted) |
| `--audit <path>` | yes | `WERKNARIO_AUDIT` | `.werknario/audit.jsonl` | Audit log file |
| `--policy <path>` | yes | `WERKNARIO_POLICY` | `.werknario/policy.json` | Path permission file |
| `--max-turns <n>` | yes | none | 12 | Cap the number of model turns for this run |

A flag wins over its matching environment variable. Everything on the command
line that is not a flag or a flag's value is joined into the task string.

### Subcommands

| Command | What it does |
|---|---|
| `node packages/cli/dist/cli.js verify [audit.jsonl] [--genesis owner/repo]` | Re-walk a hash-chained audit log and exit non-zero if the chain breaks. `--genesis` supplies the expected first-entry anchor. See [audit-and-trust.md](audit-and-trust.md). |
| `node packages/cli/dist/cli.js eval` | Run the built-in scenarios against the configured model and print a pass/fail table. Offline (`mock`) it is deterministic; against a real model it is a smoke test of your setup. |

`verify` re-computes the chain and reports a mismatch; it is a hash chain, not a
signature, and it cannot on its own detect that the tail of the file was
truncated. The chain head is stamped into the merge request to anchor it on the
Git server. Full detail in [audit-and-trust.md](audit-and-trust.md).

Locale note: the CLI defaults to English; the Web IDE extension defaults to
German. `--de` / `WERKNARIO_LOCALE=de` switches the CLI to German for both the
agent's system prompt (`packages/shared/src/prompt.ts` carries an English and a
German version) and the CLI's own outcome messages (merge conflict, auth failure,
and so on, from `packages/shared/src/friendlyError.ts`). The `[Beleg: …]` citation
tag stays identical in both languages, because the grounding checker matches it
literally. See [grounding.md](grounding.md).

## Backend

`WERKNARIO_BACKEND` selects `gitlab`, `github`, or `mock`. If it is unset, the CLI
defaults to `github` when `GITHUB_REPO` is set, otherwise `gitlab`. `mock` is
never chosen implicitly; you have to name it. Detail and token scopes live in
[backends.md](backends.md).

### GitLab (`WERKNARIO_BACKEND=gitlab`, the default)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GITLAB_TOKEN` | yes* | — | Personal or project access token, `api` scope |
| `GITLAB_PAT` | yes* | — | Alternate name for the same token; `GITLAB_TOKEN` wins if both are set |
| `GITLAB_PROJECT_ID` | yes | — | Numeric project ID, or URL-encoded `group/project` path |
| `GITLAB_BASE_URL` | no | `https://gitlab.com` | Your self-hosted instance URL |

\* one of `GITLAB_TOKEN` / `GITLAB_PAT` is required. Missing either the token or
the project ID makes the CLI exit with a clear error before any model call.

### GitHub (`WERKNARIO_BACKEND=github`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | Scope: repository contents + pull requests. See [backends.md](backends.md) |
| `GITHUB_REPO` | yes | — | `owner/repo` |
| `GITHUB_API_URL` | no | `https://api.github.com` | For GitHub Enterprise Server |

Note: on GitHub the revert path is a simplified tree swap, not a three-way git
revert. See [backends.md](backends.md).

### mock (`WERKNARIO_BACKEND=mock`)

No variables needed. An in-memory repository seeded with one demo file, for the
local offline demo and for tests. Nothing leaves the process.

## Identity

| Variable | Default | Notes |
|---|---|---|
| `WERKNARIO_AGENT_ID` | `agent:assistant` | Audit-log actor for the agent. A leading `agent:` prefix is stripped before matching against `.werknario/policy.json` |
| `WERKNARIO_HUMAN` | `human:you` | Audit-log actor for the human approving the run |

Set identity through the environment variables above, or per run with `--agent
<id>` and `--human <name>`. A missing `agent:` / `human:` prefix is added for you,
and a flag wins over the matching environment variable. Both names are written
into the audit log so each entry records which agent proposed and which human
approved.

## Run options

| Variable | CLI flag | Default | Notes |
|---|---|---|---|
| `WERKNARIO_AUTO_APPROVE` | `--yes` | unset | `"1"` to auto-approve every write |
| `WERKNARIO_DRY_RUN` | `--dry-run` | unset | `"1"` to preview without any team-visible write |
| `WERKNARIO_ROUTE` | `--route` | unset | `"1"` to enable per-turn model routing |
| `WERKNARIO_LOCALE` | `--de` | `en` | `"de"` for German prompt and CLI messages |
| `WERKNARIO_VERIFY_CMD` | `--verify-cmd <cmd>` | unset | Shell command run before a merge; non-zero blocks it |
| `WERKNARIO_BUDGET_USD` | `--budget <usd>` | unset | Cost ceiling; the run stops once accumulated cost reaches it |
| `WERKNARIO_AUDIT` | `--audit <path>` | `.werknario/audit.jsonl` | Audit log file |
| `WERKNARIO_POLICY` | `--policy <path>` | `.werknario/policy.json` | Path permission file |

The turn cap has a flag (`--max-turns <n>`, default 12) but no environment
variable. The budget gate and the turn cap are both checked after each recorded
turn; a `--verify-cmd` that exits non-zero blocks the merge, not the whole run.

## Model provider

`LLM_PROVIDER` selects `mock`, `anthropic`, `bedrock`, or `openai-compatible`.
An unset or unrecognized value falls back to `mock`. `LLM_MODEL` sets the model
id passed to the provider (default `claude-sonnet-5`); it accepts either a
canonical registry id or the provider's own raw model id. The registry lives in
`packages/shared/src/models.ts`; see [providers-and-models.md](providers-and-models.md).

| Variable | Applies to | Default | Notes |
|---|---|---|---|
| `LLM_PROVIDER` | all | `mock` | `mock` \| `anthropic` \| `bedrock` \| `openai-compatible` |
| `LLM_MODEL` | all | `claude-sonnet-5` | Canonical id or the provider's own raw model id |
| `CLAUDE_API_TOKEN` | anthropic | — | Read first; falls back to `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | anthropic | — | Fallback when `CLAUDE_API_TOKEN` is unset |
| `AWS_REGION` | bedrock | — | Passed to the Bedrock client |
| `AWS_ACCESS_KEY_ID` | bedrock | — | Read into config, but the Bedrock SDK resolves AWS credentials through its own standard chain, so set this (and `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`) as ordinary AWS environment variables |
| `AWS_SECRET_ACCESS_KEY` | bedrock | — | See above |
| `LLM_OPENAI_COMPAT_BASE_URL` | openai-compatible | — | e.g. `https://api.mistral.ai/v1` |
| `LLM_OPENAI_COMPAT_API_KEY` | openai-compatible | — | Sent as `Authorization: Bearer <key>` |

For the `bedrock` provider, `@anthropic-ai/bedrock-sdk` is an optional dependency
loaded on demand (`packages/proxy/src/providers/bedrock.ts` imports it
dynamically). It is not installed by default, so `mock` and `anthropic` keep
working without it. Install it and set `LLM_PROVIDER=bedrock` to use it; see
[providers-and-models.md](providers-and-models.md).

### Proxy server only (not needed for CLI use)

The CLI calls the provider in-process and never starts or talks to an HTTP
server. These variables matter only when you run `packages/proxy` standalone,
which is the setup the browser extension needs, since a browser cannot hold AWS
or Anthropic credentials. Full setup in [self-hosting.md](self-hosting.md).

| Variable | Default | Notes |
|---|---|---|
| `PROXY_BEARER_TOKEN` | — | Token the extension must present; when unset the proxy rejects every request |
| `PROXY_PORT` | `9109` | Listen port |
| `PROXY_ALLOWED_ORIGINS` | `*` | Comma-separated origins, or `*` |

## State files

A run reads and writes two files under `.werknario/` in the working directory.
Both paths are overridable (flag, then environment variable, then default).

| File | Default path | Flag / env | Purpose |
|---|---|---|---|
| Audit log | `.werknario/audit.jsonl` | `--audit` / `WERKNARIO_AUDIT` | Hash-chained, append-only record of every step (read, propose, approve, decline, merge, revert). Re-checked with the `verify` subcommand. See [audit-and-trust.md](audit-and-trust.md) |
| Policy | `.werknario/policy.json` | `--policy` / `WERKNARIO_POLICY` | Path permission policy: which paths the agent may write. A named approver role is defined and tested but not yet enforced. See [permissions.md](permissions.md) |

The policy controls which paths a write may touch. The grounding gate is
separate: it hard-blocks a merge request whose text cites a file or line the
agent never read, while its number-coverage check is advisory. See
[grounding.md](grounding.md).

## Examples

Local offline demo, no keys, no server (`mock` provider and `mock` backend):

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

The bundled demo substrate is a German-language music-label example, so the agent
narrates in German and follows the substrate's language. Point it at your own
repository for English. See [DEMO.md](DEMO.md).

Verify an existing audit log without doing a run:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

GitLab backend with the Anthropic API directly:

```bash
WERKNARIO_BACKEND=gitlab \
GITLAB_BASE_URL=https://gitlab.example.com \
GITLAB_PROJECT_ID=42 \
GITLAB_TOKEN=glpat-xxx \
LLM_PROVIDER=anthropic \
CLAUDE_API_TOKEN=sk-ant-xxx \
  node packages/cli/dist/cli.js "Summarize the open issues under docs/"
```

GitLab backend with Bedrock (EU inference profile), routing on and a two-dollar
budget:

```bash
WERKNARIO_BACKEND=gitlab \
GITLAB_PROJECT_ID=42 GITLAB_TOKEN=glpat-xxx \
LLM_PROVIDER=bedrock LLM_MODEL=eu.anthropic.claude-sonnet-5-... \
AWS_REGION=eu-central-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  node packages/cli/dist/cli.js "..." --route --budget 2
```

GitHub backend with an OpenAI-compatible endpoint (Mistral):

```bash
WERKNARIO_BACKEND=github \
GITHUB_REPO=my-org/my-docs GITHUB_TOKEN=ghp_xxx \
LLM_PROVIDER=openai-compatible \
LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1 \
LLM_OPENAI_COMPAT_API_KEY=... LLM_MODEL=mistral-large-3 \
  node packages/cli/dist/cli.js "..."
```

A ready-to-copy template of every variable is in `.env.example`. Related reading:
[backends.md](backends.md), [providers-and-models.md](providers-and-models.md),
[permissions.md](permissions.md), [audit-and-trust.md](audit-and-trust.md),
[troubleshooting.md](troubleshooting.md).

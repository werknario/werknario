# Self-hosting

This is the install-and-set-up guide. It covers running werknario from source,
running it in Docker, pointing it at your own Git host and model, the full set of
environment variables, EU data residency, and the two modes people ask about
most: fully unattended and fully offline.

werknario runs on your own machines and against your own repository. An agent
here is software that carries a task through to the end, not just answers: it
reads your documents, drafts a change, and opens a merge request for a human to
approve. Every change is a reviewable diff, proposed by a named agent and
approved by a named human, and the whole history can be verified rather than
trusted. Nothing about that requires a hosted service. This page gets it running
where you control it.

For the guided first run, start with [getting-started.md](getting-started.md).
This page is the reference for standing it up in a place you own.

## Requirements

- Node.js 20 or newer (the workspace declares `"engines": { "node": ">=20" }`).
- A place for your documents to live. One of:
  - a Git host you control (a self-hosted GitLab, or GitHub Enterprise Server), or
  - GitLab.com / GitHub.com.
  - For trying it out, neither is needed: the in-memory `mock` backend seeds one
    demo file and runs the whole flow with no network.
- A model provider. One of:
  - Anthropic via AWS Bedrock (EU inference profile), the EU-residency default,
  - Anthropic direct,
  - an OpenAI-compatible endpoint (Mistral, or a self-hosted vLLM/SGLang server
    running Kimi / DeepSeek / Qwen), or
  - the `mock` provider, which needs no credentials at all.
- Docker is optional. It gives you a second install path and a one-command demo,
  but everything works from a source build without it.

## Install from source

Clone the repository, install, and build. The build compiles every package and
bundles the CLI to a single file at `packages/cli/dist/cli.js`.

```bash
git clone <your-fork-or-mirror-url> werknario
cd werknario
npm install
npm run build   # Node 20+
```

Confirm the build with the local offline demo. It needs no key and no server: a
scripted model acts on an in-memory repository, so you see the full shape of a
run without configuring anything.

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

Expected output: a one-line policy notice, the agent reading a note and proposing
a new split-sheet file, then:

```
Merge request opened: mock://merge-request/1
  Merged !1.
Audit: 8 entries at .werknario/audit.jsonl — chain verified.
```

The bundled demo substrate is a German-language music-label example, so the agent
narrates its steps in German. That is expected. The agent follows the language of
the substrate it is working in; point it at your own repository to see it work in
your language.

After `npm install`, the bare `werknario` command is not on your PATH. Use the
`node packages/cli/dist/cli.js` form shown throughout this guide. If you would
rather type the short name, run this optional one-time step:

```bash
cd packages/cli && npm link   # then `werknario <args>` works anywhere
```

Everything below uses the `node packages/cli/dist/cli.js` form so the commands
work whether or not you linked.

## Install with Docker

The image is a small two-stage build: compile the workspace, then ship a pruned
production runtime. Its entrypoint is the CLI, so anything after the image name
is the task string.

The Compose file gives you two services. The `demo` service is the offline
demo with no configuration:

```bash
docker compose run --rm demo
```

The `agent` service reads its configuration from `.env` and runs against your own
repository and model. Copy the template, fill it in, then pass the task as the
command:

```bash
cp .env.example .env
# edit .env: set WERKNARIO_BACKEND, the GitLab/GitHub variables, LLM_PROVIDER, model creds
docker compose run --rm agent "Draft the split sheet from the session note"
```

Both services mount `./work` into the container and default the audit log to
`/work/audit.jsonl`, so the log survives after the container exits.

If you would rather not use Compose, build and run the image directly:

```bash
docker build -t werknario .
docker run --rm --env-file .env -v "$PWD/work:/work" \
  werknario "Summarise the new intake note into the client file"
```

The Docker path puts the CLI on the image's PATH via the entrypoint, so inside
the container the command is just the task string. That is the one place the
short form is correct without `npm link`.

## Point it at your own Git host and model

Configuration is entirely environment variables. Secrets (tokens, keys) come from
the environment, never from a command-line flag, so they stay out of your shell
history. Two examples; the full variable list is in the next section and in
[configuration.md](configuration.md).

Self-hosted GitLab with Anthropic via Bedrock (the EU default):

```bash
export WERKNARIO_BACKEND=gitlab
export GITLAB_BASE_URL=https://gitlab.example.com
export GITLAB_PROJECT_ID=42
export GITLAB_TOKEN=glpat-xxx          # scope: api
export LLM_PROVIDER=bedrock
export LLM_MODEL=eu.anthropic.claude-sonnet-5-...   # your EU inference profile id
export AWS_REGION=eu-central-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...

node packages/cli/dist/cli.js "Summarise the open issues under docs/" --route --budget 2
```

GitHub with an OpenAI-compatible endpoint (Mistral, an EU provider):

```bash
export WERKNARIO_BACKEND=github
export GITHUB_REPO=my-org/my-docs
export GITHUB_TOKEN=ghp_xxx            # scope: contents + pull requests
export LLM_PROVIDER=openai-compatible
export LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1
export LLM_OPENAI_COMPAT_API_KEY=...
export LLM_MODEL=mistral-large-3

node packages/cli/dist/cli.js "Draft a reply to the latest issue in docs/"
```

The Bedrock provider uses `@anthropic-ai/bedrock-sdk`, which is an optional
dependency. It is not installed by default so that the `mock` and `anthropic`
paths keep working without it. Install it before selecting `LLM_PROVIDER=bedrock`;
selecting Bedrock without it fails with a clear error rather than falling back
silently. See [providers-and-models.md](providers-and-models.md).

Token scopes and the exact write mechanism for each host are in
[backends.md](backends.md). The GitHub `revert` is a simplified tree swap, not a
three-way `git revert`, so treat it as "undo the merge I just did" rather than a
general revert tool; that caveat is spelled out in [backends.md](backends.md).

## Environment variable reference

Every variable the source actually reads, grouped the way the code groups them.
Sources: `packages/cli/src/config.ts` and `packages/proxy/src/config.ts`.

### Backend (where your documents live)

`WERKNARIO_BACKEND` selects `gitlab`, `github`, or `mock`. If unset, it defaults
to `github` when `GITHUB_REPO` is set, otherwise `gitlab`. `mock` is never chosen
implicitly; you have to ask for it.

| Variable | Backend | Required | Default | Notes |
|---|---|---|---|---|
| `WERKNARIO_BACKEND` | all | no | `gitlab` (or `github` if `GITHUB_REPO` set) | `gitlab` \| `github` \| `mock` |
| `GITLAB_TOKEN` | gitlab | yes* | — | Personal/project access token, `api` scope |
| `GITLAB_PAT` | gitlab | yes* | — | Same token under another name; `GITLAB_TOKEN` wins if both set |
| `GITLAB_PROJECT_ID` | gitlab | yes | — | Numeric ID, or URL-encoded `group/project` path |
| `GITLAB_BASE_URL` | gitlab | no | `https://gitlab.com` | Your self-hosted instance URL |
| `GITHUB_TOKEN` | github | yes | — | Classic PAT `repo`, or fine-grained: Contents + Pull requests (read/write) |
| `GITHUB_REPO` | github | yes | — | `owner/repo` |
| `GITHUB_API_URL` | github | no | `https://api.github.com` | For GitHub Enterprise Server |

\* one of `GITLAB_TOKEN` / `GITLAB_PAT`.

### Model provider

`LLM_PROVIDER` selects `mock`, `anthropic`, `bedrock`, or `openai-compatible`.
Unset or unrecognized values fall back to `mock`.

| Variable | Provider | Default | Notes |
|---|---|---|---|
| `LLM_PROVIDER` | all | `mock` | `mock` \| `anthropic` \| `bedrock` \| `openai-compatible` |
| `LLM_MODEL` | all | `claude-sonnet-5` | Canonical registry id, or the provider's own raw model id |
| `CLAUDE_API_TOKEN` | anthropic | — | Read first; falls back to `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | anthropic | — | Fallback if `CLAUDE_API_TOKEN` is unset |
| `AWS_REGION` | bedrock | — | e.g. `eu-central-1` |
| `AWS_ACCESS_KEY_ID` | bedrock | — | Bedrock SDK resolves AWS credentials through the standard AWS chain; set these as normal AWS env vars |
| `AWS_SECRET_ACCESS_KEY` | bedrock | — | See above |
| `AWS_SESSION_TOKEN` | bedrock | — | Only for temporary credentials |
| `LLM_OPENAI_COMPAT_BASE_URL` | openai-compatible | — | e.g. `https://api.mistral.ai/v1`, or your self-hosted endpoint |
| `LLM_OPENAI_COMPAT_API_KEY` | openai-compatible | — | Sent as `Authorization: Bearer <key>` |

### Identity and run options

| Variable | CLI flag | Default | Notes |
|---|---|---|---|
| `WERKNARIO_AGENT_ID` | `--agent <id>` | `agent:assistant` | Audit-log actor for the agent; an `agent:` prefix is added if omitted |
| `WERKNARIO_HUMAN` | `--human <name>` | `human:you` | Audit-log actor for the approving human |
| `WERKNARIO_AUTO_APPROVE` | `--yes` | unset | `1` to approve every write automatically |
| `WERKNARIO_DRY_RUN` | `--dry-run` | unset | `1` to propose and show diffs but decline every team-visible write |
| `WERKNARIO_ROUTE` | `--route` | unset | `1` to let the router pick a cheaper model per turn |
| `WERKNARIO_BUDGET_USD` | `--budget <usd>` | unset | Soft cost ceiling; the run stops once cost reaches it |
| `WERKNARIO_LOCALE` | `--de` | `en` | `de` for German prompts and CLI messages |
| `WERKNARIO_AUDIT` | `--audit <path>` | `.werknario/audit.jsonl` | Audit log file |
| `WERKNARIO_POLICY` | `--policy <path>` | `.werknario/policy.json` | Path permission file |

The permission policy controls which paths the agent may write. A named approver
role is defined and tested, but not yet enforced at merge time. See
[permissions.md](permissions.md).

### Proxy server (only for the browser extension)

The CLI calls the model provider in-process; it never starts or talks to an HTTP
server. These variables matter only if you run `packages/proxy` standalone, which
the VS Code Web IDE extension needs, because a browser cannot hold AWS or
Anthropic credentials.

| Variable | Default | Notes |
|---|---|---|
| `PROXY_BEARER_TOKEN` | — | Token the extension must present; unset rejects every request |
| `PROXY_PORT` | `9109` | Listen port (the 9100–9199 range avoids local clashes) |
| `PROXY_ALLOWED_ORIGINS` | `*` | Comma-separated origins, or `*` (safe here because auth is a bearer token, not cookies) |

## EU data residency

Because the agent works on documents that may hold personal data, the model
registry (`packages/shared/src/models.ts`) carries a `dataResidency` flag on every
model: `eu`, `self-host`, or `non-eu`. For GDPR, choose one of the first two:

- Anthropic via AWS Bedrock's EU inference profile (`LLM_PROVIDER=bedrock`, an EU
  region), or
- a model you run inside the EU yourself (a self-hosted OpenAI-compatible
  endpoint), or an EU-hosted provider such as Mistral.

The token ledger adds a 10% premium to Bedrock EU cost estimates, matching the
regional surcharge over Anthropic's list price. Kimi, DeepSeek, and Qwen are only
GDPR-safe self-hosted or through an EU host; their direct endpoints are flagged
`non-eu` and are not appropriate for personal data without a separate legal basis.

The router enforces this at deployment time, not per request. With `--route` and
the default `euOnly` policy, `validateRoutingPolicy()` rejects the policy outright
if any tier resolves to a model that is not `eu` or `self-host`, and names the
tier and model that failed. So a routing policy that could send personal data to a
non-EU model is refused before it can ever process a request. The details, the
registry fields, and how to add a model are in
[providers-and-models.md](providers-and-models.md).

## Running unattended

For a scheduled job or a pipeline where no human is at the terminal, use `--yes`
(or `WERKNARIO_AUTO_APPROVE=1`). The agent then approves each of its own writes
instead of prompting. The audit log still records who acted, so set a real agent
identity so the log is meaningful:

```bash
export WERKNARIO_AGENT_ID=agent:nightly-intake
export WERKNARIO_HUMAN=human:ops-oncall

node packages/cli/dist/cli.js "Summarise new intake notes into the client files" \
  --yes --route --budget 5 --verify-cmd "npm test"
```

Useful flags for unattended runs:

- `--route` picks a cheaper model for simple turns.
- `--budget 5` stops the run once it has cost five dollars, closing out any
  pending tool call cleanly so the conversation stays valid.
- `--verify-cmd "<cmd>"` runs a shell command before a merge; a non-zero exit
  blocks the merge. This is the pluggable check hook. A full
  CI-verify-and-auto-rollback loop is designed but not built yet, so rollback is
  offered as an explicit action rather than triggered automatically.
- `--dry-run` proposes and prints the diffs without opening anything, which is a
  good first pass before letting a scheduled job write for real.

Unattended still means auditable. Every run appends to the hash-chained log, and
you can check it afterward without a live run:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl   # exit 0 on a good chain
```

The log is a hash chain, not a signature; `verify` exits non-zero if the chain
breaks. `verify` alone cannot detect that entries were truncated off the end,
which is why the chain head is stamped into each merge request, anchoring the log
on the Git server. See [audit-and-trust.md](audit-and-trust.md).

## Keeping it offline

The `mock` provider and `mock` backend together make a run with no network and no
credentials. The provider returns scripted responses; the backend is an in-memory
repository seeded with one demo file. It is deterministic, which is why the test
suite and CI use it.

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

You can also mix: keep `WERKNARIO_BACKEND=mock` while pointing `LLM_PROVIDER` at a
real model to exercise a model against a throwaway repository, or keep
`LLM_PROVIDER=mock` while pointing the backend at a real repository to rehearse
the Git flow without spending tokens. For a genuinely air-gapped setup with a real
model, run an OpenAI-compatible model inside your own network (vLLM or SGLang) and
point `LLM_OPENAI_COMPAT_BASE_URL` at it; that keeps both the documents and the
inference on infrastructure you control.

## Self-hosting the browser extension

The CLI is the whole product for a source or Docker install. The VS Code Web IDE
extension is a second surface, for GitLab's browser IDE, and it is built and
tested. Reaching it from a real GitLab Web IDE additionally needs the standalone
proxy running (so the browser never holds model credentials) plus DNS and a
reverse proxy on your host to serve the small extension registry. The live hosted
browser demo is designed but not stood up yet. The full host setup, the registry
service, and the marketplace cut-over are documented in
[DISTRIBUTION.md](DISTRIBUTION.md).

To run the proxy locally for extension development, build the workspace, set
`PROXY_BEARER_TOKEN` and a provider, then start it:

```bash
export LLM_PROVIDER=bedrock LLM_MODEL=eu.anthropic.claude-sonnet-5-...
export AWS_REGION=eu-central-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
export PROXY_BEARER_TOKEN=$(openssl rand -hex 32)
node packages/proxy/dist/server.js   # listens on PROXY_PORT, default 9109
```

## Next steps

- First run, explained step by step: [getting-started.md](getting-started.md).
- Every variable and flag in one place: [configuration.md](configuration.md).
- Backends and token scopes: [backends.md](backends.md).
- Providers, the model registry, and the router: [providers-and-models.md](providers-and-models.md).
- Task examples: [recipes.md](recipes.md).
- What is built versus designed: [architecture-and-status.md](architecture-and-status.md).
- When something fails: [troubleshooting.md](troubleshooting.md).

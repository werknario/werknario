# Getting started

This is the shortest path from a fresh clone to a run you can trust. It takes a
few minutes and, for the first three steps, needs no account, no API key, and no
server. By the end you will have run the whole flow offline, read the audit log
it produced, verified that log, and seen what a real run against your own repo
needs.

An agent here means software that carries a task through to the end, not just
answers: it reads your files, drafts a change, and hands the change to a human to
approve before anything is final. The point of werknario is not that the agent
writes documents. It is that every change is a reviewable diff, proposed by a
named agent and approved by a named human, and the whole history can be verified
rather than trusted.

## Prerequisites

- Node 20 or newer (`node --version` to check). The repo's `engines` field
  requires `>=20`.
- git, to clone the repo.
- Docker is optional. It gives you a second way to run the offline demo without
  installing Node locally; every step below also works from source.

## Step 1 — Clone, install, build

```bash
git clone <your-clone-url> werknario
cd werknario
npm install
npm run build
```

The first `npm install` takes a few minutes and prints npm audit advisories for
the dev-only build chain (esbuild, vite, vitest). Nothing in the shipped CLI is
affected: `npm audit --omit=dev` reports 0 vulnerabilities.

`npm run build` bundles the CLI to a single file at `packages/cli/dist/cli.js`.
Every command in this guide runs that file directly with `node`. After a source
build the bare `werknario` command is not on your PATH.

Optional, once: if you would rather type `werknario` than the full node path, run
`npm link -w @werknario/cli` from the repo root to put the short command on your
PATH. This guide stays with the node form so the commands work whether or not you
did this.

## Step 2 — The 30-second offline demo

This runs the complete flow against an in-memory repository and a scripted model.
No key, no server, nothing real is touched:

```bash
npm run demo
```

`npm run demo` is a small node launcher. It works the same on Windows (PowerShell
or cmd), macOS, and Linux, because node sets the mock provider and mock backend
rather than a bash-only inline `FOO=bar` prefix. It approves each write
automatically so the demo runs unattended.

Advanced users can call the bundled CLI directly instead:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

That inline `FOO=bar` prefix is bash syntax. On Windows PowerShell set the two
variables first with `$env:LLM_PROVIDER='mock'`; cmd uses `set "LLM_PROVIDER=mock"`.
`npm run demo` avoids all of that. Drop `--yes` from the raw form and the CLI stops
to ask you before every team-visible write. What you see (the head hash is a
per-run value, so yours will differ):

```
Note: no policy file at .werknario/policy.json — agent:assistant may write any path. See docs/permissions.md.

werknario · mock/demo (mock)
Task: Draft the split sheet from the session note

Ich lese zuerst die Notiz.
  · read_file
  · propose_edit

  proposal (new file): mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md
    + # Split Sheet — Landgang (ENTWURF)
    +
    + (automatisch aus der Session-Notiz abgeleitet)
    +
    + | Beteiligte | Rolle | Anteil |
    + |---|---|---|
    + | … | … | ANTEIL OFFEN |
    +
  · create_merge_request

Entwurf vorgelegt und Merge Request geöffnet. Bitte die offenen Anteile prüfen.

— 4 model call(s), 5,680 tokens

Merge request opened: mock://merge-request/1
  Merged !1.

Audit: 9 entries at .werknario/audit.jsonl — chain verified (head <per-run hash>).
```

The agent read a note, proposed a new file (shown as a diff), opened a merge
request, merged it, and wrote an nine-entry audit log that verified. Note that
the open share is left as `ANTEIL OFFEN` rather than invented: the agent may only
write what it can ground in what it read.

The bundled demo substrate is a German-language music-label example, so the agent
narrates in German (`Ich lese zuerst die Notiz`, and so on). That is the demo
data talking, not a fixed language. The agent follows the substrate's language, so
against your own English repo it works in English. The first policy notice line
appears because this demo ships without a permission file; see
[permissions.md](permissions.md).

If you have Docker and skipped the Node install, the same demo runs as:

```bash
docker compose run --rm demo
```

## Step 3 — Read the audit log, then verify it

The offline run appended to `.werknario/audit.jsonl` in your working directory.
It is one JSON object per line, append-only. Look at it:

```bash
cat .werknario/audit.jsonl
```

Each line records who acted (`human:you`, `agent:assistant`, or `system`), what
they did, the details, and two hashes: `prevHash`, the hash of the line before
it, and `hash`, this line's own hash computed over its fields plus that
`prevHash`. That linkage is the chain (hashes abbreviated below; real values differ
per run):

```json
{"seq":3,"actor":"human:you","action":"approve","detail":{"tool":"create_merge_request"},"prevHash":"1bb3…","hash":"455b…"}
{"seq":4,"actor":"agent:assistant","action":"create_merge_request","detail":{"iid":1,"title":"Split Sheet Landgang (Entwurf)"},"prevHash":"455b…","hash":"475d…"}
```

The chain opens at `seq:0`, a `system`/`residency` entry recording the model
route werknario checked before the run (see [providers-and-models.md](providers-and-models.md#data-residency-and-gdpr)); `seq:1` is the task, then the read, the proposal, this approval, and the merge.

Check the whole chain without doing a run:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

```
Audit .werknario/audit.jsonl — chain verified (9 entries, genesis mock/demo).
```

`verify` exits 0 on a good chain and non-zero if the chain breaks, so it drops
straight into a script or a CI job. Edit, delete, reorder, or insert a line in the
middle of the file and `verify` reports the first entry that no longer checks out.

Two honest limits are worth knowing up front. This is a hash chain, not a
signature: it is tamper-evident, not something only the original actor could have
produced. And `verify` cannot detect tail truncation on its own, because a log
with its last entries chopped off is still a valid chain from the start. The
mitigation is an external anchor: when the CLI opens a merge request it stamps the
current chain head into the request description, so the git server holds a
reference the local file cannot rewrite. The full account, including what a signed
chain would add, is in [audit-and-trust.md](audit-and-trust.md).

## Step 4 — Your first real run

A real run points the same flow at your own GitLab or GitHub repository and a real
model. You give the task in plain language; the agent proposes and shows you the
diff; you approve each write in the terminal.

Configuration lives in a `.env` file in your working directory, not in inline shell
variables. The CLI reads it on startup, so the same setup works on every OS and
keeps tokens out of your shell history. Copy the template, then edit it:

```bash
cp .env.example .env
```

On Windows use `copy .env.example .env` in PowerShell or cmd.

Open `.env` and set your backend and a model route. werknario checks data residency
before the first model call and blocks any route with no verified EU residency by
default, so keep the model in the EU. Two common setups.

GitLab with Claude on AWS Bedrock (the werknario default, EU inference profile):

```
WERKNARIO_BACKEND=gitlab
GITLAB_BASE_URL=https://gitlab.com   # your self-hosted URL, if any
GITLAB_PROJECT_ID=12345
GITLAB_TOKEN=...                      # scope: api
LLM_PROVIDER=bedrock
AWS_REGION=eu-central-1               # an eu-* region is what makes this an EU route
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
LLM_MODEL=eu.anthropic.claude-...     # the EU inference profile id from your Bedrock console
```

GitHub with Mistral (EU-native):

```
WERKNARIO_BACKEND=github
GITHUB_REPO=owner/repo
GITHUB_TOKEN=...                      # scope: contents + pull requests
LLM_PROVIDER=openai-compatible
LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1
LLM_OPENAI_COMPAT_API_KEY=...
LLM_MODEL=mistral-large-3
```

With `.env` saved, run the task with no inline variables:

```bash
node packages/cli/dist/cli.js "Summarise the new intake note into the client file"
```

The run pauses at each team-visible write and asks you in the terminal (the title,
branch, and body values below are illustrative):

```
The agent wants to open a merge/pull request:
  title:  ...
  branch: ...
  body:   ...

Approve? [y/N]
```

Type `y` to proceed; anything else declines. Before the request merges it asks once
more, `Merge !12 now? [y/N]`. That terminal prompt is where the human stays in the
loop.

For an unattended or scheduled run, add `--yes` (or set `WERKNARIO_AUTO_APPROVE=1`
in `.env`) to approve every write without stopping. Reach for it deliberately, once
you trust the task:

```bash
node packages/cli/dist/cli.js "Summarise the new intake note into the client file" --yes
```

The direct Anthropic API (`LLM_PROVIDER=anthropic`, `CLAUDE_API_TOKEN=...`) is a US
route with no EU data residency, so werknario blocks it by default. Only when your
data holds no personal information, override with `WERKNARIO_ALLOW_NON_EU=1`; the CLI
prints a warning and proceeds.

Useful flags for a real run:

- `--dry-run` proposes and shows the diff, then opens nothing. Good for a first
  look at what the agent would do.
- `--yes` approves every write automatically, for an unattended or scheduled run.
- `--route` lets the deterministic router pick a cheaper model for simple steps.
- `--budget 5` stops the run once its cost reaches five dollars.
- `--verify-cmd "npm run lint"` runs a command before a merge; a non-zero exit
  blocks the merge.

Two things worth setting before you point this at anything shared. A permission
policy at `.werknario/policy.json` controls which paths the agent may write; a
named approver role is defined and tested but not yet enforced, so treat the path
policy as the live guardrail today ([permissions.md](permissions.md)). And the
grounding gate hard-blocks the merge request if the agent cites a file or line it
never read; the separate number-coverage check is advisory, not a block
([grounding.md](grounding.md)).

Every variable and flag the source actually reads is listed in
[configuration.md](configuration.md). For running werknario on your own GitLab
instance and standing up the model proxy the browser extension needs, see
[self-hosting.md](self-hosting.md).

## Step 5 — Where to go next

- [recipes.md](recipes.md) — concrete, copy-pasteable tasks: summarise an intake
  note, turn meeting notes into a structured summary, run unattended with a budget.
- [configuration.md](configuration.md) — the full reference for every environment
  variable and CLI flag.
- [providers-and-models.md](providers-and-models.md) — the model registry, the
  EU / self-host / non-EU data-residency flag, and which providers are wired up.
- [backends.md](backends.md) — GitLab, GitHub, and the in-memory mock, and how to
  get the right token scopes.
- [permissions.md](permissions.md) — the path permission policy and the approver
  role.
- [audit-and-trust.md](audit-and-trust.md) — the audit chain in full, including
  where its guarantee stops.
- [architecture-and-status.md](architecture-and-status.md) — what is built and
  tested versus what is designed and not built yet.
- [troubleshooting.md](troubleshooting.md) and [faq.md](faq.md) — when something
  does not behave.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — the build, the tests, and how new code
  is written test-first if you want to work on werknario itself.

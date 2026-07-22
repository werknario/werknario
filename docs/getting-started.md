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

`npm run build` bundles the CLI to a single file at `packages/cli/dist/cli.js`.
Every command in this guide runs that file directly with `node`. After a source
build the bare `werknario` command is not on your PATH.

Optional, once: if you would rather type `werknario` than the full node path, run
`cd packages/cli && npm link` to put the short command on your PATH. This guide
stays with the node form so the commands work whether or not you did this.

## Step 2 — The 30-second offline demo

This runs the complete flow against an in-memory repository and a scripted model.
No key, no server, nothing real is touched:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

`--yes` approves each write automatically so the demo runs unattended. Drop it and
the CLI stops to ask you before every team-visible step. What you see:

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

Audit: 8 entries at .werknario/audit.jsonl — chain verified.
```

The agent read a note, proposed a new file (shown as a diff), opened a merge
request, merged it, and wrote an eight-entry audit log that verified. Note that
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
`prevHash`. That linkage is the chain:

```json
{"seq":2,"actor":"human:you","action":"approve","detail":{"tool":"create_merge_request"},"prevHash":"1bb3…","hash":"455b…"}
{"seq":3,"actor":"agent:assistant","action":"create_merge_request","detail":{"iid":1,"title":"Split Sheet Landgang (Entwurf)"},"prevHash":"455b…","hash":"475d…"}
```

Check the whole chain without doing a run:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

```
Audit .werknario/audit.jsonl — chain verified (8 entries, genesis mock/demo).
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
diff; you approve each write in the terminal. Set the backend and the model
through environment variables (secrets stay in the environment, never in a flag or
in shell history).

Against GitLab:

```bash
export WERKNARIO_BACKEND=gitlab
export GITLAB_BASE_URL=https://gitlab.com     # your self-hosted URL, if any
export GITLAB_PROJECT_ID=12345
export GITLAB_TOKEN=...                        # scope: api
export LLM_PROVIDER=anthropic
export CLAUDE_API_TOKEN=...

node packages/cli/dist/cli.js "Summarise the new intake note into the client file"
```

Against GitHub:

```bash
export WERKNARIO_BACKEND=github
export GITHUB_REPO=owner/repo
export GITHUB_TOKEN=...                        # scope: contents + pull requests
export LLM_PROVIDER=openai-compatible
export LLM_OPENAI_COMPAT_BASE_URL=https://api.mistral.ai/v1
export LLM_OPENAI_COMPAT_API_KEY=...
export LLM_MODEL=mistral-large-3

node packages/cli/dist/cli.js "Draft a reply to the latest issue in docs/"
```

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

# The demo, in detail

Start with [getting-started.md](getting-started.md). It walks you from a fresh
clone to a run you can trust and is the entry point for everything here. This page
is the companion to it: what the local offline demo actually does, stage by stage,
so the output on your screen makes sense.

The demo is the 30-second offline run. It needs no API key and no server. The
provider is a scripted mock and the backend is an in-memory repository, so nothing
real is read or written:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

`--yes` approves each write automatically so the run finishes unattended. Without
it the CLI stops before every team-visible step and asks you first.

## What happens, stage by stage

The scripted agent moves through four stages. You can watch each one in the output.

1. **Policy notice.** The first line reports that no permission file is present, so
   `agent:assistant` may write any path. The demo ships without a
   `.werknario/policy.json` on purpose; a real setup adds one. See
   [permissions.md](permissions.md).
2. **read_file.** The agent reads the bundled session note at
   `mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md`. This is
   the input it is allowed to ground its draft in.
3. **propose_edit.** It proposes a new file,
   `mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md`, shown to you as
   a diff before anything is committed. The share it cannot derive from the note is
   left as `ANTEIL OFFEN` rather than invented. The agent may only write what it can
   ground in what it read; the grounding gate is covered in
   [grounding.md](grounding.md).
4. **create_merge_request, then merge.** It opens a merge request against the
   in-memory backend (`mock://merge-request/1`) and, because `--yes` approved it,
   merges it. Every step is appended to the audit log as it goes.

The tail of the run looks like this:

```
Merge request opened: mock://merge-request/1
  Merged !1.

Audit: 8 entries at .werknario/audit.jsonl — chain verified.
```

## Why the agent speaks German

The bundled demo substrate is a German-language music-label example, so the agent
narrates in German (`Ich lese zuerst die Notiz`, and so on). That is the demo data
talking, not a fixed language setting. The agent follows the substrate's language,
so pointed at your own English repository it works in English. Use the demo to see
the shape of the flow; use your own repo to see it in your language.

## The audit output

The run appended to `.werknario/audit.jsonl` in your working directory: one JSON
object per line, append-only, each line carrying the hash of the line before it and
its own hash computed over that link. That is the chain the final line reports as
verified.

You can check the chain again without doing another run:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

It exits 0 on a good chain and non-zero if the chain breaks, so it drops straight
into a script or a CI job. Edit, delete, or reorder a line in the middle of the
file and `verify` reports the first entry that no longer checks out.

Two honest limits. This is a hash chain, not a signature: it is tamper-evident, not
something only the original actor could have produced. And `verify` cannot detect
tail truncation on its own, because a log with its last entries chopped off is still
a valid chain from the start. The mitigation is an external anchor: when the CLI
opens a merge request it stamps the current chain head into the request
description, so the git server holds a reference the local file cannot rewrite. The
full account is in [audit-and-trust.md](audit-and-trust.md).

## The same demo under Docker

If you have Docker and did not install Node, the identical run is:

```bash
docker compose run --rm demo
```

## After the demo

The offline demo proves the flow end to end against nothing real. To point the same
flow at your own repository and a real model, follow Step 4 of
[getting-started.md](getting-started.md). From there:

- [providers-and-models.md](providers-and-models.md) — the model registry, the
  data-residency flag, and which providers are wired up.
- [backends.md](backends.md) — GitLab, GitHub, and the in-memory mock, and the token
  scopes each needs.
- [self-hosting.md](self-hosting.md) — running werknario on your own GitLab and
  standing up the model proxy the browser extension talks to.
- [architecture-and-status.md](architecture-and-status.md) — what is built and
  tested versus what is designed and not built yet.

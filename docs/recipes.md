# Recipes

Concrete ways to use werknario. Each is a real command. Set your backend and
model in the environment first (see [configuration.md](./configuration.md)); the
examples below assume that is done and show only the task and the useful flags.

## Try it with no setup

The offline demo runs the whole flow against an in-memory repo and a scripted
model — no keys, no server:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  werknario "Draft the split sheet from the session note" --yes
```

And check that it works against *your* model and backend without changing
anything real:

```bash
werknario eval
```

`eval` runs a built-in scenario and prints a pass/fail table. Offline (mock) it
is a deterministic regression check; with a real model it is a smoke test of your
setup. It exits non-zero if a check fails.

## Preview before you commit to anything

`--dry-run` lets the agent read and propose, shows you the diff, and then opens
nothing. Good for seeing what it would do:

```bash
werknario "Rewrite onboarding/welcome.md to mention the new office" --dry-run
```

## Summarise an incoming document into a client file (law firm)

```bash
werknario "Read intake/2026-07-neuer-mandant.md and add a one-paragraph summary \
to the top of clients/schmidt-gmbh/akte.md"
```

The agent reads the intake note, drafts the change, shows you the diff, and opens
a merge request once you approve. Every step is in the audit log, so later you can
show exactly what was proposed and who signed off.

## Turn meeting notes into a structured summary

```bash
werknario "From notes/2026-07-22-standup.md, write a short summary with sections \
Decisions, Open questions, and Next steps into summaries/2026-07-22.md"
```

## Reply to the newest issue as a draft

```bash
werknario "Draft a reply to the most recent issue that touches docs/, as a comment"
```

Comments are team-visible, so the agent asks you to approve the exact text first.

## Unattended, with a budget and a check before merge

For a scheduled or batch run where you trust the flow, approve automatically but
keep two guardrails: a cost ceiling, and an external check that must pass before
a merge happens.

```bash
werknario "Regenerate the index in docs/README.md from the file tree" \
  --yes --budget 1 --verify-cmd "npm run lint"
```

`--verify-cmd` runs your command (a linter, a test, a CI-status probe) before the
merge; a non-zero exit blocks it. `--route` can be added to let the agent pick a
cheaper model for the simple steps.

## Check an audit log

Any time, with no run and no model:

```bash
werknario verify .werknario/audit.jsonl
```

It exits non-zero if the chain is broken. Add `--genesis owner/repo` for the
strict check that also catches a rewritten first entry or a log pointed at the
wrong repository. See [audit-and-trust.md](./audit-and-trust.md).

## Give the agent and the human a name in the record

The audit log records who acted. Set the names per run or in the environment:

```bash
werknario "..." --agent hr-bot --human anna
```

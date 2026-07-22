# Recipes

Concrete tasks you can hand to werknario, each as a command you can run. Every
change the agent makes arrives as a reviewable diff, proposed by a named agent
and approved by a named human, and the whole history can be verified rather than
trusted.

The examples use the source-build invocation form, `node packages/cli/dist/cli.js`,
because the bare `werknario` command is not on your PATH after `npm install`. If
you prefer the short form, link it once:

```bash
cd packages/cli && npm link
```

after which `werknario <args>` works everywhere. The Docker image already puts
`werknario` on PATH, so from `docker compose run` you can drop the `node ...`
prefix.

Set your backend and model in the environment first — see
[configuration.md](configuration.md). The examples below assume that is done and
show only the task and the useful flags.

## Try it with no setup

The offline demo runs the whole flow against an in-memory repo and a scripted
model. No keys, no server:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

You will see a one-line policy notice, the agent reading a session note and
proposing a new split-sheet file, then:

```
Merge request opened: mock://merge-request/1
Merged !1.
Audit: 8 entries at .werknario/audit.jsonl — chain verified
```

The bundled demo substrate is a German music-label example, so the agent narrates
in German and drafts a `split-sheet` document. That is just the sample data; the
agent follows whatever language your substrate is written in. Point it at your own
repo (next sections) to see it work in English.

## Check your own setup

Run the built-in scenario against *your* configured model and backend without
touching anything real:

```bash
node packages/cli/dist/cli.js eval
```

`eval` prints a pass/fail table. Offline (mock) it is a deterministic regression
check; against a real model it is a smoke test of your provider and credentials.
It exits non-zero if a check fails.

## Preview before anything happens

`--dry-run` lets the agent read and propose and shows you the diff, but opens no
merge request and writes nothing team-visible. Use it to see what a task would do
before you let it run for real:

```bash
node packages/cli/dist/cli.js \
  "Rewrite onboarding/welcome.md to mention the new office in Essen" --dry-run
```

## Summarise an intake note into a client file

A new-client note lands in `intake/`. Fold a short summary into the matter file
so the next person opening the case sees the gist first:

```bash
node packages/cli/dist/cli.js \
  "Read intake/2026-07-neuer-mandant.md and add a one-paragraph summary to the \
top of clients/schmidt-gmbh/akte.md"
```

The agent reads the intake note, drafts the edit, shows you the diff, and opens a
merge request once you approve. Because it may only cite files it actually read,
a summary that references a note it never opened is blocked before the merge
request — see [grounding.md](grounding.md).

## Draft a document from a source note

Turn a raw meeting note into a structured document written to a new path:

```bash
node packages/cli/dist/cli.js \
  "From notes/2026-07-22-kickoff.md, write a project brief with sections \
Scope, Owner, and Next steps into briefs/2026-07-22-kickoff.md"
```

The source note is read, the new file is proposed as a diff against an empty
file, and nothing is created until you approve.

## Draft a reply to an issue

Have the agent draft a comment on the newest issue that touches a given area. It
proposes the exact text and waits for your approval before posting, since a
comment is team-visible:

```bash
node packages/cli/dist/cli.js \
  "Draft a reply to the most recent issue that touches docs/, as a comment"
```

Which platform the comment lands on (GitLab issue or GitHub issue) follows your
configured backend — see [backends.md](backends.md).

## Run unattended, with a budget and a pre-merge check

For a scheduled or batch task where you trust the flow, approve automatically but
keep two guardrails: a cost ceiling and an external command that must pass before
any merge:

```bash
node packages/cli/dist/cli.js \
  "Regenerate the table of contents in docs/README.md from the file tree" \
  --yes --budget 1 --verify-cmd "npm run lint"
```

`--budget 1` stops the run once its estimated cost reaches one dollar.
`--verify-cmd` runs your command (a linter, a test, a CI-status probe) after the
merge request opens and before the merge happens; a non-zero exit blocks the
merge. Everything is still recorded, so a blocked run leaves a trail you can read
back.

## Let the agent pick a cheaper model per step

`--route` lets the deterministic router send the simple steps (reading, listing
files) to a cheaper model and keep the capable model for the drafting. It stacks
with any task and with a budget:

```bash
node packages/cli/dist/cli.js \
  "Fix the broken relative links in docs/README.md" --route --budget 1
```

Which models the router chooses depends on your model registry and residency
settings — see [providers-and-models.md](providers-and-models.md).

## Name the agent and the human in the record

The audit log records who proposed a change and who approved it. Set the two
names per run so the record is legible later:

```bash
node packages/cli/dist/cli.js "..." --agent hr-bot --human anna
```

You can also set `WERKNARIO_AGENT_ID` and `WERKNARIO_HUMAN` in the environment so
every run in a session carries the same names. A named approver role is defined
but not yet enforced by the tool — see [permissions.md](permissions.md) for what
the policy does control (which paths an agent may write).

## Check an audit log

Any time, with no run and no model:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

The audit log is a hash chain, not a signature; `verify` exits non-zero if the
chain breaks. Add `--genesis owner/repo` for the strict check that also catches a
rewritten first entry or a log pointed at the wrong repository. `verify` cannot
detect tail truncation on its own, which is why the chain head is stamped into
the merge request to anchor it on the Git server. See
[audit-and-trust.md](audit-and-trust.md).

---

New to the tool? Start at [getting-started.md](getting-started.md) for the full
first run.

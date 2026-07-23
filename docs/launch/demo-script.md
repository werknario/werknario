# Demo script

The recording plan and the exact command sequence for the launch demo. Two runs
get recorded: the happy-path run that already exists, and a second run where the
agent invents a citation and the merge request is refused before a human ever
sees it. The second run is the one that carries the pitch, because the guarantee
is otherwise invisible in a happy path.

Every change is a reviewable diff, proposed by a named agent and approved by a
named human, and the whole history can be verified rather than trusted. An agent
here is software that carries a task through to the end, not just answers.

This document covers three things:

1. The unified invocation, so a cold cloner runs the exact lines shown.
2. The specification of the second mock path in
   `packages/proxy/src/providers/mock.ts` (the fabricated-citation run).
3. The recording plan for each channel.

All commands run against the in-memory backend and the scripted mock provider.
No API key, no server, no network.

Status (2026-07-23): the second mock path is built and unit-tested
(`packages/proxy/test/mock-provider.test.ts`). Run the fabricated-citation demo
with `npm run demo:blocked`, or the explicit form in section 1. Section 2 below
describes the shipped behaviour, not a to-do.

---

## 1. Unified invocation

The demo run and the `verify` step must use the same call form, or the second
line fails for anyone who cloned and did not run `npm link`. Use the source-build
form for both. It works right after `npm install && npm run build` with nothing
on PATH.

```bash
npm install
npm run build
```

Run 1, the happy path (this is what `npm run demo` already does):

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

Run 2, the fabricated-citation path (the new second mock branch, section 2):

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet and cite the fee table" --yes
```

Verify the chain, same call form:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

`verify` exits 0 on an intact chain and non-zero if the chain breaks, so the
recorded terminal shows a real exit code, not a claim.

The optional `npm link -w @werknario/cli` puts a short `werknario` on PATH. Do
not rely on it in the recording. The recorded cast uses `node
packages/cli/dist/cli.js` for both the run and the `verify` so the skeptic who
retypes the two lines gets the same result.

Attach the `30-second` wording only to this npm/source path with its exact
output. Do not attach it to the cold `docker compose run --rm demo` path, which
builds the image on first run and is not 30 seconds.

---

## 2. The second mock path (fabricated citation)

### What it demonstrates

The grounding gate lives in `packages/shared/src/executor.ts`. Before an
approval-required, team-visible write (`create_merge_request`, `add_comment`)
runs, the executor calls `validateCitations` from
`packages/shared/src/grounding.ts` against a per-conversation ledger of what
`read_file` actually returned. A citation to a file the agent never read this
session, or to lines past the length it read, is a problem. When there is a
problem the executor returns early with `isError: true` and does not open the
request (`executor.ts`, around the `create_merge_request` grounding block). A
fabricated citation blocks the merge request before the human approval step, so
it is never presented for sign-off.

Two properties matter for the recording, and both are already true in the code:

- The gate runs before approval. Even with `--yes`, the fabricated run is
  refused before `--yes` is consulted, because the grounding check returns above
  the `isApprovalRequired` branch in `executor.ts`.
- The gate is correctable, not terminal. It returns a tool result with
  `isError: true` whose text tells the agent to read the cited file and fix the
  citation, then retry. It is not a crash and not a hard stop of the loop.

The refusal text the executor returns (shown on screen in German, because it is
the executor's message) is:

```
Der Merge Request wurde NICHT geöffnet. Die Belege stimmen nicht:
- Beleg zeigt auf mock-substrate-musik/vertraege/gagen.csv, aber diese Datei
  wurde in dieser Sitzung nie gelesen.
Lies die belegte Datei mit read_file und korrigiere die Belege
(Format [Beleg: <pfad>:L<start>-L<ende>]), dann erneut versuchen.
```

### Why the mock needs a second branch

The current mock (`createMockProvider` in `mock.ts`) walks one linear script:
`read_file` → `propose_edit` → `create_merge_request` → `end_turn`. Its
`create_merge_request` description carries no `[Beleg: …]` citation, so
`validateCitations` finds nothing to reject and the happy path merges.

For the fabricated run the mock has to put a citation to a never-read file into
the `create_merge_request` description. That produces one `isError: true` tool
result. If the mock then scripted a retry, `validateCitations` would reject the
same citation again, the loop's no-progress guard in `loop.ts` would fire after
`stallLimit` identical errors (default 3), and the run would end as
`no_progress` rather than as a clean statement. So the second branch must not
retry. After it sees the refusal, it ends its turn with a plain-text
`end_turn` and no tool call.

### Branch selection

Select the branch from the task text, read once from the last user message that
carries text (`lastUserText`, already in `mock.ts`). The happy-path task
(`Draft the split sheet from the session note`) contains no fee wording, so it
keeps the existing script. The fabricated task
(`Draft the split sheet and cite the fee table`) matches on `fee` and takes the
new branch.

```ts
function wantsFabricatedCitation(messages: Message[]): boolean {
  return /\bfee\b/i.test(lastUserText(messages));
}
```

Keep the trigger a whole-word match on `fee` so the happy-path wording never
selects it by accident.

### Scripted steps of the fabricated branch

The branch reads the real session note first (so the ledger is not empty and the
contrast is honest: the agent read one file and cited a different one it never
opened), proposes the same draft, then opens a merge request whose description
cites a fee table it never read.

The never-read path used in the citation:

```
mock-substrate-musik/vertraege/gagen.csv
```

The `create_merge_request` description in the fabricated branch (this is the only
line that differs from the happy path in shape, because it carries a `[Beleg: …]`
to a file the agent did not read):

```
Split-Sheet-Entwurf. Fee split per [Beleg: mock-substrate-musik/vertraege/gagen.csv:L12].
```

`validateCitations` reports `gagen.csv` was never read this session, so the
executor returns `isError: true` and the request is not opened.

### The clean end

On the turn after the refusal, the branch must recognise that the
`create_merge_request` tool result came back as an error and stop with a
statement instead of retrying. Detect it by looking for a `tool_result` block
that pairs with the `create_merge_request` tool_use id and carries
`is_error === true`:

```ts
/** A create_merge_request tool result that came back as an error. */
function mergeRequestRefused(messages: Message[]): boolean {
  for (const message of messages) {
    for (const block of blocksOf(message)) {
      if (
        isToolResultBlock(block) &&
        block.tool_use_id.includes("create_merge_request") &&
        block.is_error === true
      ) {
        return true;
      }
    }
  }
  return false;
}
```

When `wantsFabricatedCitation` is true and `mergeRequestRefused` is true, return
a text-only assistant turn with `stop_reason: "end_turn"` and no tool call:

```ts
return {
  role: "assistant",
  content: [{ type: "text", text: "MR refused: fabricated citation" }],
  stop_reason: "end_turn",
  usage,
};
```

The loop sees no tool use and returns with `stopped: "end_turn"`. One refusal,
one honest closing line, no loop, no `no_progress`.

### Ordering guard against the stall path

`nextStage` in the current mock decides the next step by which tool results
already exist. `hasResultFor(messages, "create_merge_request")` becomes true as
soon as the attempt is made, error or not, because the error tool result still
carries the `create_merge_request` tool_use id. So after the refused attempt the
existing `nextStage` already routes to the terminal `done` step. The change is
to make that terminal step branch-aware: in the fabricated branch, when
`mergeRequestRefused` is true, emit `MR refused: fabricated citation` instead of
the happy-path success line. Guarding on `mergeRequestRefused` keeps the branch
from asserting the refusal before it has actually happened.

### What the executor and loop already give for free

Nothing in `executor.ts`, `grounding.ts`, or `loop.ts` needs to change. The gate
already returns `isError: true` with a correctable message; the loop already
turns that into a `tool_result` with `is_error: true` and continues rather than
crashing; the no-progress guard already exists as the safety net if a future
change ever did script a retry. The whole second path is scripted-provider work
in `mock.ts`.

---

## 3. Recording plan

Record the fabricated run (section 2) and the `verify` step in one terminal
session, so the audit line and the green chain follow the refusal on the same
screen. Two frames carry the story: the blocked fabricated citation, then
`verify` reporting an intact chain with exit 0.

### GIF or animated SVG, for the README

The asciinema player does not autoplay inline on a GitHub README. The README
needs a self-contained animation committed into the repo, no external host.

- Record the terminal to a `.cast` with asciinema.
- Convert to an animated SVG with `svg-term`, or to a GIF with `agg`
  (asciinema's own gif generator). SVG stays crisp and small; GIF is the safe
  fallback if a channel refuses SVG.
- Commit the asset into the repo (for example under `docs/launch/`), and
  reference it above the fold in the README.

Keep the run short. The frames that must be legible are the refusal text and the
`verify` exit line. Everything between can move quickly.

### The real `.cast`, for terminal-native channels

Keep the raw asciinema `.cast` for asciinema.org and any terminal-native channel
that plays it. This is the artifact a skeptic scrubs through, so it stays
unedited: the real command, the real refusal, the real exit code.

### Static title frame, for Reddit and Lobsters

Reddit and Lobsters do not autoplay a terminal. Cut a single static frame that
puts the two load-bearing moments side by side:

- Left: the refused fabricated citation (the `NICHT geöffnet` block from the
  executor, with the `gagen.csv` never-read line visible).
- Right: `verify` reporting an intact chain and exiting 0.

One image, both moments, no motion required.

### What each frame must show, in words

- Frame A: the agent proposed a merge request citing `gagen.csv:L12`, and the
  gate refused it because that file was never read this session. A fabricated
  citation blocks the merge request. No human was asked.
- Frame B: `node packages/cli/dist/cli.js verify .werknario/audit.jsonl`
  reporting an intact chain and exiting 0. The log is a hash chain, not a
  signature; `verify` exits non-zero if the chain breaks.

Do not bake a fixed unit-test count or a fixed entry count into any frame or
caption. Those numbers drift as the suite and the run change, and a stale number
undercuts the point of the recording. If the terminal output shows a live count,
that is fine, because it is the run's own output; do not add one by hand.

---

## 4. Pre-record checklist

Before recording, confirm each of these by running it, not by memory:

- `npm install && npm run build` completes clean from a fresh clone.
- Run 1 (happy path) merges and prints an audit line.
- Run 2 (fabricated) prints the refusal and ends with
  `MR refused: fabricated citation`, and does not loop or end as `no_progress`.
- The fabricated run's refusal happens even with `--yes` present.
- `node packages/cli/dist/cli.js verify .werknario/audit.jsonl` exits 0 on the
  run just recorded, and the recorded terminal shows that exit.
- Both the run and the `verify` line use the identical `node
  packages/cli/dist/cli.js` call form.

Break a line in the middle of `.werknario/audit.jsonl` once, off-camera, and
confirm `verify` exits non-zero and names the first entry that no longer checks
out. That is the negative control behind the green frame; it does not go in the
recording, but it confirms the green frame means something.

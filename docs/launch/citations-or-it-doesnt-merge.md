# Citations or it doesn't merge

An agent here is software that carries a task through to the end, not just
answers. werknario's agent reads the documents in a Git repo, drafts a change,
and hands it to a person to approve. The line this essay is about sits between
the draft and the approval:

> Every change is a reviewable diff, proposed by a named agent and approved by a
> named human, and the whole history can be verified rather than trusted.

The part of that sentence people underestimate is "reviewable". A diff is only
reviewable if the claims around it hold up. If the agent writes "the label keeps
40% per the split sheet" and there is no split sheet, or the sheet says
something else, the reviewer is now doing forensic work instead of reviewing.
werknario's answer is narrow and mechanical: before a change becomes team-visible,
every citation in it is checked against what the agent actually read this
session. A citation to a file or line the agent never read blocks the merge
request. It never reaches a human for sign-off.

## Run it

No account, no key, no server.

```bash
npm install
npm run build
npm run demo
```

The demo runs the whole flow against an in-memory repo with a scripted model:
the agent reads a session note, proposes a new split-sheet file, opens a merge
request, merges it, and writes an audit log. The last line is the one to watch:

```
Audit: 9 entries at .werknario/audit.jsonl — chain verified.
```

Then check the log on its own, offline, no model call:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

That is the happy path. The citation gate is what stands between the draft and
that happy path, and it is easiest to explain by walking through what it does
and does not do.

## What a citation is here

The contract is written down in `docs/grounding.md` and implemented in
`packages/shared/src/grounding.ts`. It has two halves, and both run.

When the agent reads a file with `read_file`, it gets the content back with line
numbers, under a header that names the path and line count
(`formatReadResult` in `grounding.ts`). That gives the agent stable coordinates.
Every factual claim it then makes about the repo is backed in one form:

```
[Beleg: vertraege/split.md:L4-L9]
```

`Beleg` is German for "citation". The tag is kept identical in every language on
purpose, so the parser stays language-independent (`CITATION_RE` in
`grounding.ts`). A claim without a live citation is not grounded, and a citation
only holds if the file was read in this session and the line span lies inside the
length that was read.

## The hard block: provenance

Before a team-visible write runs, the executor checks the citations in the text
against a ledger of what was read. This happens for `create_merge_request` and
`add_comment`, and it happens before the human is asked to approve. The wiring is
in `packages/shared/src/executor.ts`:

```ts
const { problems } = validateCitations(groundedText, ledger);
if (problems.length > 0) {
  return {
    content: `${was}. Die Belege stimmen nicht:\n${describeProblems(problems)}\n…`,
    isError: true,
  };
}
```

`validateCitations` flags three things: a citation to a file the session never
read, a line span past the length that was read, and a span written backwards.
Any one of them means the merge request is not opened. The message goes back to
the agent, not to the human, and the agent is told to read the cited file and
correct the citation before trying again. It is a correctable error, not a crash:
the run continues, and the agent gets a second try with the file actually read.
So a fabricated source never becomes a diff a person has to catch.

This is the claim the essay title stakes out. A citation to a line the agent
never read blocks the merge request. Not "flags for later", not "warns the
reviewer". The write does not happen.

## The soft check: numbers

If provenance is fine, a second check runs, and this one is advisory on purpose.
`checkNumberGrounding` looks at each number in a cited sentence and asks whether
that number also appears in the cited line. When one does not, it attaches a note
to the success message for the reviewer to look at. It does not block.

The reason it does not block is in the code comment and worth stating plainly: a
number can be computed or aggregated. A sum is not present verbatim in any single
source line, and a legitimate merge request would be rejected if the check were
hard. A gate that rejects correct work stops being trusted, and a check nobody
trusts is worse than no check. So this one flags, the agent passes the note on in
its summary, and the human decides.

Be exact about what this means, because it is easy to overclaim. The gate does
not block wrong numbers. A fabricated citation blocks the merge request; a number
that is off but sits under an honest citation gets a note, not a wall. If you need
the number itself gated, that is your reviewer's job, and the note is there to
point them at it.

## Where the check stops

The contract checks two things and is honest about a third it does not.

It checks provenance, hard. It checks number coverage, advisory. It does not
check whether a cited line actually supports the claim in substance. The agent
can cite a real line, inside a file it really read, that does not back the
sentence it is attached to. Catching that needs a judge that scores the claim
against the cited content, which has a cost per merge request and can itself be
wrong. It is held back on purpose until the deterministic checks show their
limits in real use. `docs/grounding.md` records this as the next possible step,
not a shipped feature.

The same honesty applies to the neighbours of this gate, and it is worth naming
so the citation check is not read as more than it is:

- The audit log the demo verifies is a hash chain, not a signature. `verify`
  exits non-zero if the chain breaks. Optional Ed25519 signing is opt-in
  (`keygen`, then `verify --pubkey`); it is not the default. See
  `docs/audit-and-trust.md`.
- A path permission policy controls which paths the agent may write
  (`.werknario/policy.json`). The approver check is enforced in the CLI against
  the authenticated token holder, but org-wide and cross-surface enforcement is
  on the roadmap, and the VS Code Web IDE surface does not run it yet. See
  `docs/permissions.md`.
- The router refuses to send personal data to a non-EU model by default. That is
  a routing control you can inspect, not a compliance guarantee.

## Why this is the wedge

A coding agent will happily edit files and open a pull request. Point Aider or
OpenHands at a docs repo and it works, up to the moment the model states
something the documents do not say. A confident fabrication becomes a diff, and
the diff looks exactly like a correct one. The reviewer carries the whole burden
of catching it.

werknario moves one specific class of that burden earlier and makes it
deterministic. A claim tied to a source the agent never opened does not survive to
the review step. You do not have to trust that the agent read the split sheet
before it wrote about the split sheet. The check ran, and you can run it too:

```bash
npm run demo
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

That is the whole point of "verified rather than trusted", reduced to something
you can execute. The gate is in `packages/shared/src/grounding.ts` and its wiring
is in `packages/shared/src/executor.ts`. Read both. If the check is weaker than
this essay says, the code will tell you before I do.

## Related

- `docs/grounding.md` — the citation contract in full, with the syntax table and
  the deliberate limit.
- `docs/audit-and-trust.md` — the hash-chained log the demo verifies, and where
  that guarantee stops.
- `docs/permissions.md` — the path policy and the approver check.
- `docs/architecture-and-status.md` — what runs today against what is designed,
  not built.

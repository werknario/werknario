# Grounding / citation contract

This is the grounding half of the system. It addresses the fabrication worry at the root: the Git repo is the single source of truth, and the agent may only claim what it actually read there, naming the place it read it.

The contract has two halves, both built and tested:

- **Repo retrieval** — the agent finds where a fact lives.
- **Citation requirement** — the agent backs the claim, and may only back what it read.

An agent here is software that carries a task through to the end, not just answers. That includes reading the substrate before it writes about it.

## What the contract does

1. Find. `search_files` looks for a term (substring, case-insensitive) across the files and returns `path:line: snippet`. A hit is a find, not a citation: the agent then reads the file with `read_file` and only cites afterward, so it sees the context instead of quoting a line out of it. The search records nothing toward citing. It runs portably over the backend's `listFiles`/`readFile`, so no search engine is required; for small to medium substrates this is enough.
2. Read with line numbers. `read_file` returns its content with line numbers (`L1: …`, `L2: …`), preceded by a header giving the path and line count. That gives the agent stable coordinates to refer to.
3. Cite. Every factual claim about the substrate is backed in the form `[Beleg: <path>:L<start>-L<end>]` (also `:L<line>` for a single line, or no line span for the whole file). The system prompt and the tool descriptions require it. `Beleg` is German for "citation"; the tag is kept identical in every language on purpose, so the parser stays language-independent.
4. Check provenance (hard block). Before a team-visible write runs (`create_merge_request`, `add_comment`), the executor checks the citations in the text against a ledger of what was actually read in this session. A citation to a file that was never read, or to lines beyond the length that was read, blocks the write with a correctable message back to the agent. The check runs before the human approval step, so a fabricated citation is never even presented for sign-off.
5. Check numbers (advisory, not a block). If provenance is fine, the executor additionally checks whether each number in a cited sentence also appears in the cited line. If it is missing, a note for the reviewer is attached to the success message. This deliberately does not block: a number can be wrong, or computed or aggregated (a sum is not present verbatim in the source). A hard block would reject legitimate merge requests and make the check untrustworthy in short order. The agent passes the note on in its summary to the human.

So the gate hard-blocks a fabricated citation. The number-coverage check is advisory only: it flags numbers a reviewer should look at, it does not block wrong numbers.

## Deliberate limit

What is checked is provenance (hard) and the coverage of numbers (advisory). What is not checked is whether a cited line actually supports a claim in substance (the agent cites a real line that does not back the sentence). That is the next possible step: a groundedness gate with an LLM judge that scores the whole claim against the cited content. It has a cost per merge request and can itself be wrong, so it is held back on purpose until the deterministic checks show their limits in real use. See [docs/architecture-and-status.md](architecture-and-status.md) for where this sits on the roadmap.

Also still open: the commit SHA in a citation. Right now the contract checks path and line span. The SHA gets added once the backend reports the commit a file was read at, which would keep a citation stable over time as well ("line 12 as of commit abc").

## Where the code lives

- `packages/shared/src/grounding.ts` — the pure logic: line numbering, citation parser, ledger, checks. No side effects, fully unit-tested (`test/grounding.test.ts`).
- `packages/shared/src/executor.ts` — the wiring: one ledger per conversation, `read_file` records and numbers, `create_merge_request`/`add_comment` check before approval and backend (`test/executor.test.ts`).
- `packages/shared/src/prompt.ts`, `tools.ts` — the citation requirement in the system prompt and the tool descriptions.

## Citation syntax

| Form | Meaning |
|---|---|
| `[Beleg: vertraege/split.md:L4-L9]` | lines 4 to 9 of the file |
| `[Beleg: katalog/x.csv:L12]` | line 12 |
| `[Beleg: vertraege/split.md]` | the whole file (weakest citation) |

A citation only holds if the file was read with `read_file` in the same session and the line span lies within the length that was read.

## Related

- [docs/audit-and-trust.md](audit-and-trust.md) — the hash-chained audit log that records the run, complementary to the grounding gate.
- [docs/permissions.md](permissions.md) — the path permission policy that governs which paths the agent may write.
- [docs/getting-started.md](getting-started.md) — run the offline demo and watch the citation contract in a real proposal.

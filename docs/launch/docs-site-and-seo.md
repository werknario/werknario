> Draft / launch planning. This is a plan for retitling the existing docs
> pages toward search intent and for a docs index page. It changes no page's
> content here; it names what to change and where. Concept reference:
> `werknario/docs/marketing/2026-07-22-marketing-konzept.md`, section 6
> ("Doc-SEO").

# Docs site and doc-SEO plan

The docs are already written and accurate. What they are not written for is the
query a person actually types when they hit the problem werknario solves. This
plan does two things: retitle five load-bearing pages so the page title matches
the search intent, and propose a thin docs index page that gathers them.

The product claim these pages have to support, unchanged across every English
surface: every change is a reviewable diff, proposed by a named agent and
approved by a named human, and the whole history can be verified rather than
trusted. An agent here is software that carries a task through to the end, not
just answers.

Scope note. This plan touches page titles, a one-line lede per page, and a new
index page. It does not rename any file: the README nav and the cross-links
between docs point at filenames, so a filename change breaks links for no SEO
gain. The title (the `# H1`, which a docs generator emits as the HTML `<title>`)
is what carries the query match, and it is safe to change without touching a
single link.

One thing to be honest about up front: raw Markdown on a GitHub repo does not
give a page its own `<title>` or meta description. GitHub sets the tab title to
`repo/path at branch`. So the retitles below only rank once the docs are served
through a site that emits a per-page `<title>` and `<meta name="description">`
from the page. The generator choice is out of scope here (see the index section);
the retitles are written to be correct whether the page is read on GitHub or on a
generated site.

## 1. The retitle map (old title to new title)

Five pages carry a distinct search intent. For each: the current `# H1`, the
proposed `# H1`, the one-line lede to sit under it, and a meta description (under
155 characters) for the generated-site case. Filenames stay as they are.

### grounding.md — intent: grounding / citation gate

- **Current H1:** `Grounding / citation contract`
- **New H1:** `The citation gate: a source the agent never read blocks the merge request`
- **Lede:** How werknario stops a fabricated citation before a human ever sees
  the proposal, and the one check it deliberately leaves advisory.
- **Meta description:** werknario's grounding gate hard-blocks a merge request
  when a citation points at a file or line the agent never read this session.
- **Primary query:** "block AI hallucinated citation", "citation gate agent"
- **Secondary:** "grounding gate LLM", "agent cite sources before write"
- Note for the writer: keep the page's own distinction intact. Origin is the
  hard block; the number-coverage check is advisory, not a block. Do not let the
  new title drift into "blocks wrong numbers".

### audit-and-trust.md — intent: tamper-evident hash-chained audit log

- **Current H1:** `Audit and trust`
- **New H1:** `The tamper-evident, hash-chained audit log, and where its guarantee stops`
- **Lede:** An append-only hash chain that `verify` exits non-zero on when the
  chain breaks, plus the two gaps it cannot close on its own and how they are
  closed.
- **Meta description:** A hash-chained audit log for agent changes: verify exits
  non-zero if the chain breaks. A hash chain, not a signature; signing is opt-in.
- **Primary query:** "tamper-evident audit log", "hash chained log verify"
- **Secondary:** "agent audit trail git", "append-only audit jsonl"
- Note for the writer: the title says "and where its guarantee stops" on purpose.
  The page's honesty (tail truncation, unsigned by default, optional Ed25519) is
  the trust signal; a title that only promised strength would undercut it.

### permissions.md — intent: path permission policy

- **Current H1:** `Permissions`
- **New H1:** `The path permission policy: which paths an agent may write`
- **Lede:** A small glob-based JSON file that controls which path globs an agent
  may write, plus the honest scope of the approver rules.
- **Meta description:** werknario's policy file controls which paths an agent may
  write, per path glob. Permissive by default; a start-closed template ships.
- **Primary query:** "restrict AI agent file write paths", "agent path policy"
- **Secondary:** "scope agent to folder", "glob write permission agent"
- Note for the writer: the title claims exactly the enforced half, "which paths
  an agent may write". The approver half is bound to the authenticated identity
  in the CLI and is not yet enforced across every surface, so keep it out of the
  title and precise in the body (the page already is).

### providers-and-models.md — intent: EU data-residency router

- **Current H1:** `Providers and models`
- **New H1:** `Providers, models, and the EU data-residency router`
- **Lede:** Four model providers, a model registry with prices and a residency
  flag, and a gate that refuses a non-EU route for personal data by default.
- **Meta description:** werknario resolves each route's data residency and blocks
  a non-EU route by default. Set WERKNARIO_ALLOW_NON_EU=1 to override.
- **Primary query:** "EU data residency LLM router", "GDPR self-hosted model gate"
- **Secondary:** "block non-EU model personal data", "Bedrock EU inference agent"
- Note for the writer: "EU data-residency router" describes the mechanism. Do not
  let it become "makes you GDPR-compliant" or "legally required" anywhere on the
  page or in the meta description. The gate refuses a non-EU route by default;
  that is the checkable claim.

### architecture-and-status.md — intent: built vs designed

- **Current H1:** `Architecture and status`
- **New H1:** `Architecture and status: what runs today, what is designed but not built`
- **Lede:** A hard line between what is built and tested and what is planned, the
  supervised flow step by step, and the monorepo layout.
- **Meta description:** An honest split of werknario: the built-and-tested CLI
  flow and backends, versus the hosted demo, auto-rollback, and Sigstore roadmap.
- **Primary query:** "what does werknario do", "AI agent built vs planned"
- **Secondary:** "werknario architecture", "agent document workflow status"
- Note for the writer: this page is the canonical resolver for the
  README-vs-status question. The extension, proxy, and registry are built and
  tested; only the publicly reachable hosted demo is outstanding (DNS plus a
  Caddy entry). The title and lede should carry that, not the older "extension
  not built" framing.

### Summary table

| File (unchanged) | Old H1 | New H1 | Intent |
|---|---|---|---|
| `grounding.md` | Grounding / citation contract | The citation gate: a source the agent never read blocks the merge request | citation gate |
| `audit-and-trust.md` | Audit and trust | The tamper-evident, hash-chained audit log, and where its guarantee stops | audit log |
| `permissions.md` | Permissions | The path permission policy: which paths an agent may write | path policy |
| `providers-and-models.md` | Providers and models | Providers, models, and the EU data-residency router | residency router |
| `architecture-and-status.md` | Architecture and status | Architecture and status: what runs today, what is designed but not built | built vs designed |

Two mechanical follow-ups when these land:

- The README's "Documentation" nav lists these by their old short label
  ("grounding", "permissions", and so on). The nav labels can stay short; the H1
  is what the generated site emits as `<title>`. No README change is required for
  the retitle, but if the docs move to a generated site, mirror the new ledes in
  the nav descriptions.
- A docs generator should be configured to emit the meta description from a
  per-page field (front matter or the lede), not to auto-truncate the first
  paragraph. The descriptions above are written to that length on purpose.

## 2. The grounding page and the "English version" question

The concept (section 6) lists an expected cost: "the German-language
GROUNDING.md needs an English version, or it won't rank for the target queries."
That was true when the concept was written. It is not true in this repo now.

Verified state: `docs/grounding.md` is already written in English end to end. The
only German token in it is `Beleg`, which is the citation marker kept identical
across languages on purpose so the parser stays language-independent, not a sign
the page is German. So the SEO action for this page is the retitle in section 1,
not a translation.

That changes what to do with the path the concept named:

- **`docs/grounding.en.md` (the brief's named target): not needed.** There is no
  German `grounding.md` to translate. Creating `grounding.en.md` next to an
  already-English `grounding.md` would produce two English pages competing for the
  same query, which is worse for ranking, not better.
- **If a German-audience grounding page is wanted for the DACH track**, it belongs
  at `docs/de/grounding.md`, matching the convention this repo already set:
  `docs/de/compliance.md` is the one German page today, linked from the README as
  "Compliance (DE)". A `docs/de/grounding.md` would sit beside it and be linked the
  same way. That is a separate deliverable from the English-facing SEO work and is
  not required for the launch queries, which are English.

Recommendation: drop `grounding.en.md` from the launch checklist, apply the
retitle, and file a German `docs/de/grounding.md` under the DACH track only if the
regulated audience asks for it. This is a state correction against the concept, not
a disagreement with it: the translation the concept anticipated has already
happened.

## 3. A thin docs index page (structure, generator-agnostic)

The README already has a good "Documentation" nav block grouped by task. A docs
index page is the same idea given its own landing surface, so a generated docs
site has a home and so the retitled concept pages have a place that leads with
their new intent. This is a structure proposal, not a generator choice: it is a
single Markdown page (for example `docs/index.md`, or `docs/README.md` if the
generator uses that as the section home) that a static-site generator can also
consume as its landing page.

Proposed structure, top to bottom:

1. **Title and the one-liner.** The page H1, the canonical one-liner verbatim,
   and the agent definition on its first appearance. One short paragraph on what
   werknario is (an agent for office paperwork, changes as reviewable diffs, files
   in Git).

2. **Start here.** Two links and one runnable line: `getting-started`, the offline
   demo command (`npm run demo`, no key and no server), and `DEMO` for the
   detailed walk-through. This block gets a skeptic from the index to a running
   flow in one step.

3. **The five concept pages, grouped as "How it works, and how to check it".**
   This is the load-bearing group and it leads with the retitled pages, each with
   its new lede as the one-line description:
   - the citation gate (`grounding.md`)
   - the audit log (`audit-and-trust.md`)
   - the path permission policy (`permissions.md`)
   - the EU data-residency router (`providers-and-models.md`)
   - architecture and status, built vs designed (`architecture-and-status.md`)
   Add `llm-communication.md` here as the wire-format detail page.

4. **Run it.** The task-oriented pages: `configuration`, `backends`, `recipes`,
   `self-hosting`.

5. **Ship and troubleshoot.** `DISTRIBUTION`, `troubleshooting`, `faq`.

6. **Regulated organisations (DE).** A single link to `docs/de/compliance.md`,
   labelled so the DACH reader finds it and the English reader can skip it. If a
   German grounding page lands (section 2), it joins here.

7. **Project.** `CONTRIBUTING`, `GOVERNANCE`, `CODE_OF_CONDUCT`, `SECURITY`,
   `ADAPTERS`.

Two rules for the index that keep it honest:

- It links to the offline demo, not a hosted one. No "try it hosted" until the
  DNS record and the Caddy entry on the host are in place; until then the index
  points at the local offline demo, the same as the README.
- The concept-page group (item 3) leads the page, above "Run it". The reason a
  provenance-affine reader stars werknario is the checkable mechanism, so the
  index should put the checkable mechanism first, not the install steps.

Skeleton (headings only, to hand to whoever writes the page):

```
# werknario documentation
<one-liner + agent definition + one paragraph>

## Start here
- getting-started · DEMO · `npm run demo`

## How it works, and how to check it
- The citation gate — grounding.md
- The audit log — audit-and-trust.md
- The path permission policy — permissions.md
- The EU data-residency router — providers-and-models.md
- Architecture and status (built vs designed) — architecture-and-status.md
- LLM communication — llm-communication.md

## Run it
- configuration · backends · recipes · self-hosting

## Ship and troubleshoot
- distribution · troubleshooting · faq

## Regulated organisations (DE)
- Compliance (DE) — docs/de/compliance.md

## Project
- CONTRIBUTING · GOVERNANCE · CODE_OF_CONDUCT · SECURITY · ADAPTERS
```

## 4. Claims check for the retitles and the index

Every title and lede above was written against the launch claims-guardrail. The
ones that sit closest to a line, and why they stay on the right side of it:

- The permissions title says "which paths an agent may write", never "four-eyes
  enforced" or "approver role enforced". The approver check is bound to the
  authenticated identity in the CLI and is not yet enforced on every surface, so
  it stays out of the title.
- The audit title says "hash-chained" and "where its guarantee stops", never
  "signed" or "non-repudiable" as the default. Ed25519 signing is opt-in and is
  described that way on the page.
- The grounding title says a source the agent never read blocks the merge request.
  It does not say "blocks wrong numbers"; number coverage is advisory on the page
  and must stay advisory in the title.
- The residency title and meta say the router blocks a non-EU route by default.
  Neither says "makes you GDPR-compliant" or "legally required". Compliance
  language stays off the English SEO surfaces and lives on `docs/de/compliance.md`.

No title uses a trigger word from the gate, no exclamation marks, and none makes a
claim a reader cannot check by running the offline demo or reading the cited page.

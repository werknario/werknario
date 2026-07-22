# LLM communication

How the agent talks to the model: which model it picks, how much it spends doing
so, and how it stays off any single vendor. An agent here is software that
carries a task through to the end, not just answers, so it makes many model
calls per task and the cost of those calls adds up. Everything below is
deterministic, self-hostable, and runs without a third-party service. The
decision behind it and the evidence sit in the werknario repo under
`docs/decisions/2026-07-22-llm-kommunikationsschicht.md` and
`docs/research/2026-07-22-*.md`.

This page is the wire layer and the economics. Which providers and models exist,
what they cost, and where they run is the companion page
[providers-and-models.md](providers-and-models.md); the concrete environment
variables are in [configuration.md](configuration.md).

## The provider abstraction

A provider is one function. The `Provider` interface
(`packages/proxy/src/providers/index.ts`) is `createMessage(req) -> response`:
one model turn in, one model turn out, no agent-loop state. Everything above it
(the agent loop, grounding, the tool executor, the audit log) is
provider-agnostic and never learns which vendor answered.

The shape on the wire is a small subset of the Anthropic Messages API
(`packages/shared/src/types.ts`): `LlmRequest` carries `system`, `messages`,
`tools`, and an optional `model` and `max_tokens`; `LlmResponse` carries the
content blocks, a `stop_reason`, the model that answered, and the token `usage`.
No more than the tool-use loop needs.

Four providers are built and tested behind that interface:

- `mock` — deterministic scripted responses, no network, no credentials. Used by
  the test suite, CI, and the local offline demo.
- `anthropic` — calls `api.anthropic.com` directly. Only for environments
  explicitly allowed to bypass the EU-residency default.
- `bedrock` — Anthropic via AWS Bedrock on an EU inference profile. The
  production default, because personal data stays in the EU.
- `openai-compatible` — any OpenAI-style chat-completions endpoint (Mistral,
  Kimi, DeepSeek, Qwen, or a self-hosted vLLM/SGLang server). A small
  translation layer (`openai-translate.ts`) maps the wire format both ways.

`createProvider(config)` picks one by name and touches only the SDK that
provider actually needs, so choosing `mock` or `anthropic` never requires the
Bedrock SDK to be installed. Adding a fifth model is an entry in the registry
below plus, at most, a small translation layer. It is not a rewrite of the
agent.

## Four building blocks

### 1. Model registry (`packages/shared/src/models.ts`)

werknario is not tied to Claude. Every usable model is one entry with its
provider, price, context window, tool-use capability, and data residency. A
further model (Kimi, Mistral, a self-hosted one) is an entry here, not a change
to the agent. The `dataResidency` field (`eu` / `self-host` / `non-eu`) carries
the GDPR classification on the model itself, so the router and the reviewer can
read it off one place.

Currently verified: the Anthropic models (Haiku 4.5, Sonnet 5, Opus 4.8, Fable
5) at Bedrock-EU residency, with prices checked against platform.claude.com as
of 2026-07-22. Prices change (the `verifiedOn` field records when each was
checked); Sonnet 5 leaves its introductory price on 2026-08-31. Non-Claude
entries (Mistral Large 3 on an EU route, self-hosted Kimi, and cheaper non-EU
direct routes) are in the registry too, with prices marked honestly as `null`
where they were not part of the pricing research.

Residency is a property of the route, not the model, so the same family can have
two entries: an EU or self-host route and a cheaper non-EU direct route. The
matching is fail-safe. The "safe" entries match only their explicit canonical
id, so a raw model name returned by an aggregator falls back to the non-EU
entry, priced correctly and treated as non-EU by the GDPR check, rather than
being mistaken for EU-safe.

### 2. Token account (`packages/shared/src/tokens.ts`)

The agent used to discard every usage signal the API returned. Now a simple,
pure account runs: `TokenLedger.record(usage, model)` after each response, and
`totals()` returns tokens and cost. The cost comes from the registry, weighted
by the verified prices (output counts more than input, a cache read almost
nothing). An unknown model is not invented: `costUsd` stays 0 and
`unpricedCalls` increments, so the gap is visible rather than papered over. The
usage numbers are coerced to finite values first, so one malformed API response
cannot silently poison the account for the rest of the session.

`estimateCostUsd(usage, model, { bedrockEu })` prices a single call; the
Bedrock-EU regional surcharge (+10%) comes in as a flag, because it depends on
the endpoint, not the model.

A budget is optional: `new TokenLedger({ budget: { maxUsd, warnAtRatio } })`.
`status()` reports `ok` / `warn` / `over`. The account blocks nothing on its
own. Whether the agent steps down a model tier, asks the human, or stops on
`warn`/`over` is the loop's call through its budget gate (see below).

### 3. Model router (`packages/shared/src/routing.ts`)

Deterministic and rule-based, with no extra classifier call. The rule is plain
code, readable in a merge request. `selectTier` maps signals (which tool, which
paths, cost so far) onto a tier: pure reads are cheap (Haiku), edit proposals
are standard (Sonnet), sensitive paths (`vertraege/`, `verwaltung/`) or
multi-file changes are high (Opus). A soft budget brake (`softBudgetUsd`) steps
one tier down when it is exceeded.

Provider-agnostic: which model each tier uses lives in the policy
(`modelByTier`). The default is Claude tiers over Bedrock EU; you switch to Kimi
or Mistral by editing the policy, not the code. `validateRoutingPolicy` refuses
a policy whose model has no verified EU data residency (`euOnly`, on by default),
so a misconfigured tier cannot leak personal data by accident. An unknown model
counts as not safe, on purpose: when in doubt, no data leaves.

### 4. Prompt caching (providers)

The `anthropic` and `bedrock` providers put a `cache_control` breakpoint on the
system prompt. That prompt is large and identical across turns, and a cache read
costs 10% of the input base price. It is the clearest lever on cost and was
sitting unused. The effect shows up in the token account, because
`cache_read_input_tokens` grows across turns and the ledger prices cache-write
and cache-read tokens separately. The `openai-compatible` layer sends no caching
hint today; whether caching happens there depends on the endpoint's own
defaults.

## Self-healing: the no-progress guard

A tool that throws is not fatal. The loop turns it into an error tool result and
lets the model try again, so one failed write does not crash the whole run. The
risk is the opposite failure: the model repairing the same thing in circles and
burning the turn and cost budget on it.

`runAgentLoop` (`packages/shared/src/loop.ts`) guards against that. After each
turn it takes the signature of the error tool results (sorted and joined). If
that signature is identical to the previous turn's, a stall counter increments;
any progress (no errors, or different errors) resets it. Once the same errors
repeat `stallLimit` times in a row (default 3, so two retries then stop), the
loop ends with `stopped: "no_progress"` and a valid transcript. The agent stops
honestly instead of pretending it can fix something it cannot. The same discreet
exit applies when the turn limit or the cost budget is hit: every pending
`tool_use` gets a paired error `tool_result` so a resumed conversation stays
valid.

## Git-native memory: the decision log

The answer to agent amnesia is not a black-box vector store but versioned,
diffable documents in the repo, under the same citation contract and audit log
as everything else. `packages/shared/src/memory.ts` formats and parses a
decision entry: what was decided, what triggered it, and why, with citations in
the `[Beleg: path:Lx-Ly]` format that [grounding.md](grounding.md) enforces.
Each entry names the acting agent and the approving human, and can point back to
the merge request that carried it and the audit-log record that proves it.

A memory entry is not hidden side state. Writing one goes through the normal
`propose_edit` -> `create_merge_request` -> human-approval path, so it is a
reviewed, approved document like any other. A later run finds the relevant
entries with the ordinary `search_files` / `read_file` tools and cites them the
same way it cites any source. The provenance chain is in
[audit-and-trust.md](audit-and-trust.md); who may write where is in
[permissions.md](permissions.md).

## Wired into the loop

`runAgentLoop` keeps a token account at all times (observation only) and returns
`result.usage`. Three optional levers, off by default, do not change today's
behaviour:

- `events.onUsage(usage, totals)` fires after every response with the running
  totals. The extension turns that into a token counter in the status bar.
- `budgetGate(totals) => "continue" | "stop"` is checked at the same point as
  the turn limit. On `"stop"` the loop ends cleanly (`stopped: "budget"`) with a
  valid transcript.
- `selectModelForTurn(ctx) => modelId` picks the model per turn.
  `makeSelectModelForTurn(policy)` builds it from a routing policy, and
  `signalsFromMessages` derives the routing signals from the history the loop
  already holds.

## What is not turned on yet (deliberately open)

The registry, the ledger, the router, prompt caching, and the loop hooks are all
built and tested. Turning routing on in production and setting a budget are
operator decisions, not defaults:

- Enabling the router in operation needs the exact Bedrock-EU inference-profile
  ids (canonical name to full `eu.anthropic.…-v1:0` id), checked against the
  Bedrock Models API (AWS access required). Until then `selectModelForTurn`
  stays off in the extension, so a canonical name cannot end up as
  `anthropic.…` without the EU prefix.
- The budget value (a daily or per-session limit in USD) is an operator choice,
  not a default. Until it is set, the budget gate is off.
- The Bedrock `usage` field names are very likely identical to the first-party
  API but have not been checked against a real Bedrock call.
- Further models (Kimi, Mistral, and others) are prepared as registry entries;
  their prices, residency, and tool-use land as they are verified.

For where this sits in the whole system, see
[architecture-and-status.md](architecture-and-status.md); to run the agent, see
[getting-started.md](getting-started.md).

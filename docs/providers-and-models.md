# Providers and models

werknario is not tied to one model vendor. A `Provider` is one function,
`createMessage(req) -> response`, and everything above it (the agent loop,
grounding, the tool executor, the audit log) is provider-agnostic. Four
providers exist today. Adding a fifth model is an entry in the model registry
plus, if the endpoint needs a new wire format, a small translation layer like
`openai-translate.ts`. It is not a rewrite of the agent.

The wire format the proxy speaks, and how a turn flows through it, is covered
in [llm-communication.md](llm-communication.md). This page is about which
providers and models exist, what they cost, where they run, and how the
router and budget pick between them.

## The four providers

| Provider | `LLM_PROVIDER` value | What it is | When to use |
|---|---|---|---|
| Mock | `mock` | Deterministic scripted responses, no network, no credentials | Tests, the local offline demo, CI |
| Anthropic direct | `anthropic` | Calls `api.anthropic.com` directly | Only for environments explicitly allowed to bypass the EU-residency default |
| Bedrock | `bedrock` | Anthropic via AWS Bedrock, EU inference profile | The production default (GDPR: EU data residency) |
| OpenAI-compatible | `openai-compatible` | Any OpenAI-style chat-completions endpoint | Mistral, Kimi, DeepSeek, Qwen, or a self-hosted vLLM/SGLang server |

All four are built and tested. The concrete environment variables for each
live in [configuration.md](configuration.md). The Bedrock provider needs the
optional `@anthropic-ai/bedrock-sdk` package installed; without it, selecting
`bedrock` fails with a clear error rather than silently falling back to
something else. The OpenAI-compatible provider refuses to start without
`LLM_OPENAI_COMPAT_BASE_URL`, for the same reason: no silent default.

## Prompt caching

The `anthropic` and `bedrock` providers put an `ephemeral` cache breakpoint on
the system prompt. The system prompt is long and identical across turns, and a
cache read costs a fraction of the base input-token price (a tenth, at current
Anthropic list prices). The token ledger accounts for cache-write and
cache-read tokens separately, so the savings show up in the reported cost.

The `openai-compatible` translation layer does not send a caching hint today.
Whether caching happens there at all depends on the endpoint's own defaults.

## The model registry

`packages/shared/src/models.ts` is a flat catalog, one `ModelSpec` per usable
model:

| Field | Meaning |
|---|---|
| `id` | Canonical short name, the registry key (e.g. `claude-sonnet-5`) |
| `label` | Human-readable name |
| `provider` | Which provider serves this model |
| `match` | Substrings that map a provider's raw model id back to this entry |
| `contextWindow` | Token context window |
| `supportsTools` | Whether the model does reliable tool-use, required for the agent |
| `dataResidency` | `eu` \| `self-host` \| `non-eu` (see below) |
| `price` | USD per 1M tokens (input / output / cache write / cache read), with a `verifiedOn` date, or `null` if not yet verified |

The token ledger (`tokens.ts`) prices every call against this catalog; the
router (`routing.ts`) picks model ids from it. Prices drift, so treat the table
below as illustrative and read `models.ts` for the current catalog and its
`verifiedOn` dates before relying on a number:

| id | provider | data residency | price (in / out per 1M tok) |
|---|---|---|---|
| `claude-haiku-4-5` | bedrock | eu | $1 / $5 |
| `claude-sonnet-5` | bedrock | eu | $2 / $10 (introductory; the `note` field carries the end date and the post-introductory price) |
| `claude-opus-4-8` | bedrock | eu | $5 / $25 |
| `claude-fable-5` | bedrock | eu | $10 / $50 (more than Opus; not the default choice) |
| `mistral-large-3` | openai-compatible | eu | $0.50 / $1.50 |
| `qwen3-coder-ovhcloud` | openai-compatible | eu | not verified (`null`) |
| `deepseek-v4-flash-ovhcloud` | openai-compatible | eu | not verified (`null`) |
| `deepseek-v4-flash-direct` | openai-compatible | non-eu | $0.14 / $0.28 |
| `kimi-k2-instruct-selfhost` | openai-compatible | self-host | not priced (compute cost only) |
| `kimi-k2-direct` | openai-compatible | non-eu | $0.55 / $2.20 (aggregator price, not vendor-confirmed) |

An unknown model id (not in the registry, and no `match` pattern hits it)
prices as `costUsd: 0, priceUnknown: true`. The ledger never invents a number
for a model it does not recognize; instead it counts the call under
`unpricedCalls` so the gap is visible rather than hidden.

## Data residency and GDPR

`dataResidency` on each `ModelSpec` answers one question: where does the
request actually get processed?

| Value | Meaning |
|---|---|
| `eu` | The provider guarantees EU data residency (Bedrock's EU inference profile, Mistral via La Plateforme in Paris) |
| `self-host` | Open weights, run inside the EU yourself. No token price; the cost is your own compute |
| `non-eu` | Only reachable through a non-EU endpoint. Not appropriate for personal data without a separate legal basis (SCCs, for example). The registry flags these so a deployment does not send personal data there by accident |

`isEuSafe(modelId)` looks a model up and returns `true` only for `eu` or
`self-host`. An unrecognized model id is not safe by default; the function
fails closed rather than assuming the best.

Matching is deliberately asymmetric for safety. The "safe" entries (self-host,
EU-via-hoster) match only their exact canonical id. A raw model name a provider
actually returns (`moonshotai/Kimi-K2-Instruct`, say) falls through to the
non-EU direct entry instead, so an unexpected raw id gets priced and
residency-flagged correctly rather than counted as EU-safe just because the
family name matches. The path permission policy in
[permissions.md](permissions.md) controls which files the agent may touch; the
residency flag here is the separate question of where the model runs.

## Adding a model

Adding a model is a new `ModelSpec` entry, with no change to the agent loop,
the router, or the token ledger. Two steps:

1. Add one entry to the `MODELS` array in `packages/shared/src/models.ts`. Fill
   in `id`, `label`, `provider`, `match`, `contextWindow`, `supportsTools`,
   `dataResidency`, and either a verified `price` (with a `verifiedOn` date) or
   `null` if the price is not yet confirmed. Do not guess a price; `null` is the
   honest value and the ledger handles it.
2. Add a test to `packages/shared/test/models.test.ts` that pins the two facts
   that matter: the model's `dataResidency` (via `isEuSafe`) and, if it is
   priced, that `estimateCostUsd` returns the number you expect. The existing
   tests there are the template. For a non-EU or self-host route, also assert
   how `canonicalModelId` resolves a raw provider id, so the fail-safe matching
   stays covered.

Mistral is the easiest EU-native model to turn on, and it is already in the
registry (`mistral-large-3`, `openai-compatible`, `eu`, verified price). Point
`LLM_OPENAI_COMPAT_BASE_URL` at La Plateforme (or an EU-hosted Mistral
endpoint) and set `LLM_MODEL=mistral-large-3`.

Kimi, DeepSeek, and Qwen are GDPR-safe only self-hosted or via an EU host. The
registry carries both routes where they exist: an EU-hosted entry
(`qwen3-coder-ovhcloud`, `deepseek-v4-flash-ovhcloud` via OVHcloud AI
Endpoints; prices not yet verified, so check before rollout) and a direct,
non-EU entry (`deepseek-v4-flash-direct`, `kimi-k2-direct`) that is fine for
workloads without personal data but not for anything touching real user
information.

## The deterministic router

`--route` (or `WERKNARIO_ROUTE=1`) turns on per-turn model selection: the
router picks a model for each turn instead of using one fixed model for the
whole run. The idea is to spend a cheap model on cheap turns and a strong model
where it matters, without a non-technical operator configuring anything and
without an extra classifier call. The rule set (`routing.ts`) is plain code,
readable in a merge request, and runs in this order:

1. A pure read (`read_file`, `list_files`) is always `simple`.
2. A turn that touches a sensitive path (a path under one of
   `sensitivePathPrefixes`) is never below `standard`; if more than one path is
   touched in the same turn, it escalates to `high`.
3. More than three touched files at once escalates to `high`.
4. A write/proposal tool (`propose_edit`, `write_file`, `create_merge_request`,
   `add_comment`) or an unrecognized turn defaults to `standard`.
5. A soft budget: once session cost crosses `softBudgetUsd`, the chosen tier
   steps down by one.

`DEFAULT_ROUTING_POLICY` (used when you pass `--route` with no custom policy):

```
simple   -> claude-haiku-4-5
standard -> claude-sonnet-5
high     -> claude-opus-4-8
sensitivePathPrefixes: ["vertraege/", "verwaltung/"]
softBudgetUsd: 0   (off)
euOnly: true
```

`validateRoutingPolicy()` checks a policy before it is used: with `euOnly` (the
default), every tier's model must resolve to `eu` or `self-host`, or the policy
is rejected outright, naming which tier and model failed. This is meant to run
at deployment time, before a policy with a non-EU tier can ever process a real
request.

Without `--route`, every turn uses the single model from `LLM_MODEL`.

## Token budget

`--budget <usd>` (or `WERKNARIO_BUDGET_USD`) sets `TokenBudget.maxUsd`, with a
fixed warn threshold at 80% (`warnAtRatio: 0.8`). The `TokenLedger`
(`tokens.ts`) accumulates cost after every model turn, and the agent loop's
`budgetGate` stops the run once `costUsd >= maxUsd`. It stops cleanly: every
pending tool call is closed out as an aborted `tool_result` (marked
`is_error`), so the transcript stays valid and a resumed conversation does not
send a dangling tool_use. A run stopped this way reports `stopped: "budget"`.

If the Bedrock EU inference profile is in use, the ledger adds a 10% premium to
every cost estimate (`BEDROCK_EU_PREMIUM`), matching the regional surcharge over
Anthropic's list price.

The router and the budget compose. A real run with both, against GitLab and
Bedrock (env from [configuration.md](configuration.md)):

```
node packages/cli/dist/cli.js "Draft the split sheet from the session note" --route --budget 5
```

To see the flow with no key and no server, the local offline demo takes the
same flags:

```
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock node packages/cli/dist/cli.js "Draft the split sheet from the session note" --route --budget 5 --yes
```

The bundled demo substrate is a German-language music-label example, so the
agent narrates in German and follows the substrate's language; point it at your
own repository for English. For the wider onboarding path, start at
[getting-started.md](getting-started.md).

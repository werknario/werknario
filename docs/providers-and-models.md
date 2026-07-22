# Providers and models

werknario is not locked to one model vendor. A `Provider` is one function,
`createMessage(req) -> response`, and everything above it (the agent loop,
grounding, the tool executor) is provider-agnostic. Four providers exist
today. Adding a fifth is an entry in the model registry plus, if it needs a
new wire format, a small translation layer like `openai-translate.ts`. It's
not a rewrite of the agent.

## The four providers

| Provider | `LLM_PROVIDER` value | What it is | When to use |
|---|---|---|---|
| Mock | `mock` | Deterministic scripted responses, no network, no credentials | Tests, offline demos, CI |
| Anthropic direct | `anthropic` | Calls `api.anthropic.com` directly | Only for environments explicitly allowed to bypass the EU-residency default |
| Bedrock | `bedrock` | Anthropic via AWS Bedrock, EU inference profile | The production default (GDPR: EU data residency) |
| OpenAI-compatible | `openai-compatible` | Any OpenAI-style chat-completions endpoint | Mistral, Kimi, DeepSeek, Qwen, or a self-hosted vLLM/SGLang server |

Configuration for each is in [`configuration.md`](./configuration.md). The
Bedrock provider needs the optional `@anthropic-ai/bedrock-sdk` package
installed; without it, selecting `bedrock` fails with a clear error rather
than silently falling back to something else.

Prompt caching (an `ephemeral` cache breakpoint on the system prompt) is
implemented for the `anthropic` and `bedrock` providers. The system prompt is
long and identical across turns, and a cache read costs a fraction of the
base input-token price. The `openai-compatible` translation layer does not
send a caching hint today; caching there, if the endpoint supports it,
depends on the endpoint's own defaults.

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
| `price` | USD per 1M tokens (input/output/cache write/cache read), with a `verifiedOn` date, or `null` if not yet verified |

The token ledger (`tokens.ts`) prices every call against this catalog; the
router (`routing.ts`) picks model ids from it. Prices drift, so treat the
table below as illustrative and check `models.ts` for the current catalog and
its `verifiedOn` dates before relying on a number:

| id | provider | data residency | price (in/out per 1M tok) |
|---|---|---|---|
| `claude-haiku-4-5` | bedrock | eu | $1 / $5 |
| `claude-sonnet-5` | bedrock | eu | $2 / $10 (introductory; see `note` in source) |
| `claude-opus-4-8` | bedrock | eu | $5 / $25 |
| `claude-fable-5` | bedrock | eu | $10 / $50 |
| `mistral-large-3` | openai-compatible | eu | $0.50 / $1.50 |
| `qwen3-coder-ovhcloud` | openai-compatible | eu | not verified (`null`) |
| `deepseek-v4-flash-ovhcloud` | openai-compatible | eu | not verified (`null`) |
| `deepseek-v4-flash-direct` | openai-compatible | non-eu | $0.14 / $0.28 |
| `kimi-k2-instruct-selfhost` | openai-compatible | self-host | not priced (compute cost only) |
| `kimi-k2-direct` | openai-compatible | non-eu | $0.55 / $2.20 (aggregator price, not vendor-confirmed) |

An unknown model id (not in the registry, and no `match` pattern hits it)
prices as `costUsd: 0, priceUnknown: true`. The ledger never invents a number
for a model it doesn't recognize.

## Data residency and GDPR

`dataResidency` on each `ModelSpec` answers one question: where does the
request actually get processed?

| Value | Meaning |
|---|---|
| `eu` | The provider guarantees EU data residency (Bedrock's EU inference profile, Mistral via La Plateforme Paris) |
| `self-host` | Open weights, run inside the EU yourself. No token price; cost is your own compute |
| `non-eu` | Only reachable through a non-EU endpoint. Not appropriate for personal data without a separate legal basis (SCCs, for example). The registry flags these so a deployment doesn't end up sending personal data there by accident |

`isEuSafe(modelId)` looks a model up and returns `true` only for `eu` or
`self-host`. An unrecognized model id is not safe by default; the function
fails closed rather than assuming the best.

Matching is deliberately asymmetric for safety. The "safe" entries
(self-host, EU-via-hoster) match only their exact canonical id. A raw model
name a provider actually returns (`moonshotai/Kimi-K2-Instruct`, say) falls
through to the non-EU direct entry instead, so an unexpected raw id gets
priced and residency-flagged correctly rather than wrongly counted as
EU-safe just because the family name matches.

## Adding a model

Mistral is the easiest EU-native model to turn on. It's already in the
registry (`mistral-large-3`, `openai-compatible`, `eu`, verified price).
Point `LLM_OPENAI_COMPAT_BASE_URL` at La Plateforme (or an EU-hosted Mistral
endpoint) and set `LLM_MODEL=mistral-large-3`.

Kimi, DeepSeek, and Qwen are GDPR-safe only self-hosted or via an EU host.
The registry carries both routes where they exist: an EU-hosted entry
(`qwen3-coder-ovhcloud`, `deepseek-v4-flash-ovhcloud` via OVHcloud AI
Endpoints; prices not yet verified, check before rollout) and a direct,
non-EU entry (`deepseek-v4-flash-direct`, `kimi-k2-direct`) that's fine for
workloads without personal data but not for anything touching real user
information.

Adding a new model is a new `ModelSpec` entry, with no change needed to the
agent loop, the router, or the token ledger.

## The deterministic router

`--route` / `WERKNARIO_ROUTE=1` turns on `selectModelForTurn`, which picks a
model per turn instead of using one fixed model for the whole run. The rule
set (`routing.ts`) runs in this order:

1. A pure read (`read_file`, `list_files`) is always `simple`.
2. A path under a sensitive prefix is never below `standard`; touching more
   than one sensitive path at once escalates to `high`.
3. More than three touched files at once escalates to `high`.
4. A write/proposal tool (`propose_edit`, `create_merge_request`,
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

`validateRoutingPolicy()` checks a policy before it's used: with `euOnly`
(the default), every tier's model must resolve to `eu` or `self-host` or the
policy is rejected outright, listing which tier and model failed. This is
meant to run at deployment time, before a policy with a non-EU tier can ever
process a real request.

Without `--route`, every turn uses the single model from `LLM_MODEL`.

## Token budget

`--budget <usd>` / `WERKNARIO_BUDGET_USD` sets `TokenBudget.maxUsd`, with a
fixed warn threshold at 80% (`warnAtRatio: 0.8`). The `TokenLedger`
(`tokens.ts`) accumulates cost after every model turn, and the agent loop's
`budgetGate` stops the run once `costUsd >= maxUsd`. It stops cleanly: every
pending tool call is closed out as an aborted `tool_result` so the
conversation stays valid. A run stopped this way reports `stopped: "budget"`.

If the Bedrock EU inference profile is in use, the ledger adds a 10% premium
to every cost estimate (`BEDROCK_EU_PREMIUM`), matching the regional
surcharge over Anthropic's list price.

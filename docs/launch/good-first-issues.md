# Good first issues

A ready-to-file set of first contributions for werknario, cut from the real
adapter surface. Each one is small, lives in a predictable place, and has a
single verifiable finish line.

For context: werknario proposes document changes as reviewable diffs. Every
change is a reviewable diff, proposed by a named agent and approved by a named
human, and the whole history can be verified rather than trusted. An agent here
is software that carries a task through to the end, not just answers. The three
adapter seams a first contribution usually touches are a model row
(`packages/shared/src/models.ts`), a provider
(`packages/proxy/src/providers/`), and a backend
(`packages/gitlab-client` or `packages/github-client`). The `registry/` package
is unrelated; it is the VS Code extension gallery-proxy, not the model registry.

Every issue below shares the same acceptance floor: the offline mock loop stays
green and `npm test` passes.

```bash
npm run build
npm run demo   # reads a note, proposes a split-sheet, opens mock://merge-request/1, merges, verifies the chain
npm test
```

The demo needs no key and no server. It narrates in German because the bundled
demo substrate is a German-language music label; that is the content, not a
language setting.

Labels for every issue in this file: `good first issue`, `adapter`.

---

## 1. Fill in the verified price for the two OVHcloud model rows

**Labels:** `good first issue`, `adapter`

**Context.** Two catalog rows ship with `price: null` and a note to check the
price before rollout: `qwen3-coder-ovhcloud` and `deepseek-v4-flash-ovhcloud`.
Until they carry a price, the token ledger reports `priceUnknown` for those
routes and cannot estimate a run's cost. A contributor with access to OVHcloud
AI Endpoints pricing can look up the list price and fill it in.

**Files.**
- `packages/shared/src/models.ts` — the `qwen3-coder-ovhcloud` and
  `deepseek-v4-flash-ovhcloud` entries (both `price: null` today).
- `packages/shared/test/models.test.ts` — add a cost assertion.

**What to do.** Replace `price: null` with a `ModelPrice` object
(`inputPerMTok`, `outputPerMTok`, `verifiedOn` set to the date you checked;
`cacheReadPerMTok`/`cacheWritePerMTok` only if the endpoint documents them).
Keep `dataResidency: "eu"` and do not change the `match` array: it matches only
the explicit canonical id on purpose, so a raw provider id still falls back to a
non-EU entry.

**Done when.** `estimateCostUsd(...)` returns `priceUnknown: false` for the row
you priced, with a `toBeCloseTo` cost assertion in the test. Mock loop green,
`npm test` passes.

---

## 2. Add an EU-safe model row for an uncataloged openai-compatible endpoint

**Labels:** `good first issue`, `adapter`

**Context.** `ADAPTERS.md` lists "more openai-compatible model rows" under
Wanted. Because the `openai-compatible` provider already reaches any
OpenAI-style chat endpoint, most new models are a catalog entry, not new code.
Pick an endpoint with a published price and a real EU route (for example a
Mistral model on La Plateforme, or an OVHcloud AI Endpoints model).

**Files.**
- `packages/shared/src/models.ts` — one new `ModelSpec` row.
- `packages/shared/test/models.test.ts` — a matching assertion.

**What to do.** Set all eight required fields (`id`, `label`, `provider`,
`match`, `contextWindow`, `supportsTools`, `dataResidency`, `price`). Residency
is a property of the route, not the model family: for a hoster-EU route set
`euHosts`, and keep the safe entry's `match` limited to its explicit canonical
id so a bare provider id resolves to the non-EU direct entry, not to your
EU row. Verify the price with a `verifiedOn` date, or set `price: null` if you
cannot.

**Done when.** The test asserts `getModel(id)?.dataResidency`, `isEuSafe(id)`,
and (for a priced row) a cost check via `estimateCostUsd(...)`. If the model can
carry personal data, prove a raw provider id does not resolve to a non-EU entry
by accident. Mock loop green, `npm test` passes.

---

## 3. Cover the openai-compatible missing-base-url guard with a test

**Labels:** `good first issue`, `adapter`

**Context.** `createOpenAiCompatibleProvider` throws a specific error when
`LLM_OPENAI_COMPAT_BASE_URL` is unset, so a misconfigured proxy fails loudly
instead of sending a request to nowhere. That guard has no test today.

**Files.**
- `packages/proxy/src/providers/openai-compatible.ts` — the `if (!baseUrl)`
  throw at the top of the factory.
- `packages/proxy/test/` — a new test file (for example
  `openai-compatible.test.ts`), next to the existing `openai-translate.test.ts`.

**What to do.** Build a `ProxyConfig` with `provider: "openai-compatible"` and
`openaiCompatible.baseUrl` undefined, then assert the factory throws with the
base-url message. Follow the shape of the other proxy tests: no live network
call.

**Done when.** The new test proves the throw. Mock loop green, `npm test`
passes.

---

## 4. Replace the hardcoded 8192 max_tokens fallback with a named constant

**Labels:** `good first issue`, `adapter`

**Context.** All three real providers repeat the same fallback,
`req.max_tokens || 8192`. One named constant removes the magic number and gives
the default a single place to live.

**Files.**
- `packages/proxy/src/providers/anthropic.ts`
- `packages/proxy/src/providers/bedrock.ts`
- `packages/proxy/src/providers/openai-compatible.ts`

Each has the literal `8192`. Define one constant in the providers directory (for
example exported from `packages/proxy/src/providers/index.ts`) and import it
into all three.

**What to do.** No behaviour change: the default stays 8192. This is a
readability change that keeps the three providers in step. The work stays inside
`packages/proxy/src/providers/`.

**Done when.** The three providers reference one shared constant instead of
three literals. Mock loop green, `npm test` passes.

---

## 5. Make the "no staged edits" backend error read in English

**Labels:** `good first issue`, `adapter`

**Context.** Both backends throw a German-only string when
`create_merge_request` runs with nothing staged, while the surrounding code and
comments are English. The message should match the rest of the file.

**Files.**
- `packages/gitlab-client/src/backend.ts` — the guard in `createMergeRequest`.
- `packages/github-client/src/backend.ts` — the same guard.
- `packages/gitlab-client/test/backend.test.ts` and
  `packages/github-client/test/backend.test.ts` — both assert the current
  string with `/Keine vorgeschlagenen/`, so both need updating.

**What to do.** Give both backends the same English message (for example: no
proposed changes to commit, call `propose_edit` first). Update the two tests to
assert the new text. This is a backend detail in the client packages, not in
`registry/`.

**Done when.** Both backends throw the same English message and both tests
assert it. Mock loop green, `npm test` passes.

---

## 6. Add a test for the GitHub root-commit revert guard

**Labels:** `good first issue`, `adapter`

**Context.** GitHub's revert is a simplified tree swap, not a three-way
`git revert`. `revertViaBranch` refuses a commit that has no parent (a
repository's root commit) with a clear error, because there is no pre-commit
tree to swap back to. The happy path is tested; the guard is not.

**Files.**
- `packages/github-client/src/client.ts` — `revertViaBranch`, the no-parent
  guard.
- `packages/github-client/test/client.test.ts` — add a case alongside the
  existing `revertViaBranch` describe block.

**What to do.** Drive `revertViaBranch` against a commit whose fetched detail
reports no parent, using the same request-router pattern the existing revert
test uses. Assert it rejects with the root-commit message and does not issue a
branch-create call.

**Done when.** The guard has a test that fails without it. Mock loop green,
`npm test` passes.

---

## Before you open the PR

Run the offline mock loop and the test suite (both shown at the top). New
behaviour gets a failing test before the implementation that makes it pass, per
[`CONTRIBUTING.md`](../../CONTRIBUTING.md). Sign off your commit with
`git commit -s` (DCO); unsigned commits are not merged.

---

## CONTRIBUTING reference: add a backend, a provider, or a model

The block below is the top section of [`CONTRIBUTING.md`](../../CONTRIBUTING.md),
reproduced here so a first-time contributor can size the work without leaving
this page. `CONTRIBUTING.md` is the source of truth; if the two ever drift,
follow it.

> **Add a backend, a provider, or a model.** werknario is provider-agnostic and
> backend-agnostic on purpose. Adding a choice should not touch the agent loop.
>
> **A model** is one entry in `packages/shared/src/models.ts`, plus a test. A
> `ModelSpec` has eight required fields, and a literal copy compiles only if you
> set all of them: `id`, `label`, `provider`, `match`, `contextWindow`,
> `supportsTools`, `dataResidency` (`eu`, `self-host`, or `non-eu`), and `price`
> (a `ModelPrice` with `inputPerMTok`, `outputPerMTok`, and `verifiedOn`, or
> `null` if you cannot verify it). The quickest path is to copy an existing
> entry and change all eight. The token ledger and the router both read this
> catalog, so nothing else changes. The model registry is
> `packages/shared/src/models.ts`. It is not the `registry/` package, which is
> the unrelated gallery-proxy service. Add a matching assertion to
> `packages/shared/test/models.test.ts`: the residency flag, `isEuSafe(id)`, and
> a cost check via `estimateCostUsd(...)` for priced models.
>
> **A provider** turns one model request into one model response over a specific
> wire format. The existing ones live in `packages/proxy/src/providers/`: `mock`,
> `anthropic`, `bedrock`, and one generic `openai-compatible`. Most new endpoints
> need no new code: the `openai-compatible` provider already reaches any
> OpenAI-style chat-completions endpoint (Mistral, Kimi, DeepSeek, Qwen, a
> self-hosted vLLM/SGLang server) via `LLM_OPENAI_COMPAT_BASE_URL`,
> `LLM_OPENAI_COMPAT_API_KEY`, and `LLM_MODEL`. For those you add a model entry
> and set env vars. A genuinely new wire format is a new file in
> `packages/proxy/src/providers/` that returns a `Provider`
> (`createMessage(req)`), wired into `createProvider()` in
> `packages/proxy/src/providers/index.ts`, with the new name added to
> `ProviderName`/`ProxyConfig` in `packages/proxy/src/config.ts` and to
> `ProviderKind` in `packages/shared/src/models.ts`.
>
> **A backend** is where a diff becomes a merge or pull request. The details
> live in `packages/gitlab-client` and `packages/github-client`; both implement
> the same `ToolBackend` interface (`backend.ts`), with the REST specifics in
> `client.ts`. Fix a quirk of one host there, not in the shared core. The GitHub
> revert is a simplified tree swap, not a three-way `git revert`.
>
> **Before you open the PR**, run the offline mock loop. It needs no key and no
> server and is fully deterministic:
>
> ```bash
> npm run build
> npm run demo
> ```
>
> A green run reads a note, proposes a new split-sheet file, opens
> `mock://merge-request/1`, merges it, and ends with an audit line that reports
> the chain verified. Then run `npm test` and `npm run typecheck`, and add a test
> for the new behaviour.

#!/usr/bin/env bash
# Opens the six good-first-issues from docs/launch/good-first-issues.md on the
# GitHub mirror. Requires the GitHub CLI (`gh`) authenticated against
# github.com/werknario/werknario. Run once — it does not deduplicate.
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "gh (GitHub CLI) not found. Install it and run 'gh auth login'."; exit 1; }

# "good first issue" is a GitHub default label; "adapter" is ours.
gh label create adapter --description "Adapter surface: backend, provider, or model" --color 0e8a16 2>/dev/null || true
LABELS="good first issue,adapter"

gh issue create --label "$LABELS" \
  --title "Fill in the verified price for the two OVHcloud model rows" \
  --body $'Two catalog rows ship with `price: null`: `qwen3-coder-ovhcloud` and `deepseek-v4-flash-ovhcloud`. Until they carry a price the token ledger reports `priceUnknown` for those routes.\n\n**Files.** `packages/shared/src/models.ts` (the two entries), `packages/shared/test/models.test.ts` (add a cost assertion).\n\n**Do.** Replace `price: null` with a `ModelPrice` (`inputPerMTok`, `outputPerMTok`, `verifiedOn`). Keep `dataResidency: "eu"` and do not change the `match` array.\n\n**Done when** `estimateCostUsd(...)` returns `priceUnknown: false` for the priced row, with a `toBeCloseTo` assertion. Offline mock loop green, `npm test` passes.\n\nFull detail: `docs/launch/good-first-issues.md` (#1).'

gh issue create --label "$LABELS" \
  --title "Add an EU-safe model row for an uncataloged openai-compatible endpoint" \
  --body $'The `openai-compatible` provider already reaches any OpenAI-style endpoint, so most new models are a catalog entry, not new code. Pick an endpoint with a published price and a real EU route.\n\n**Files.** `packages/shared/src/models.ts` (one new `ModelSpec`), `packages/shared/test/models.test.ts` (a matching assertion).\n\n**Do.** Set all eight required fields. For a hoster-EU route set `euHosts`, and keep `match` limited to the explicit canonical id so a bare provider id falls back to the non-EU entry.\n\n**Done when** the test asserts `getModel(id)?.dataResidency`, `isEuSafe(id)`, and (for a priced row) a cost check. Offline mock loop green, `npm test` passes.\n\nFull detail: `docs/launch/good-first-issues.md` (#2).'

gh issue create --label "$LABELS" \
  --title "Cover the openai-compatible missing-base-url guard with a test" \
  --body $'`createOpenAiCompatibleProvider` throws when `LLM_OPENAI_COMPAT_BASE_URL` is unset, so a misconfigured proxy fails loudly. That guard has no test today.\n\n**Files.** `packages/proxy/src/providers/openai-compatible.ts` (the `if (!baseUrl)` throw), a new `packages/proxy/test/openai-compatible.test.ts`.\n\n**Do.** Build a `ProxyConfig` with `provider: "openai-compatible"` and `openaiCompatible.baseUrl` undefined, assert the factory throws with the base-url message. No live network.\n\n**Done when** the new test proves the throw. Offline mock loop green, `npm test` passes.\n\nFull detail: `docs/launch/good-first-issues.md` (#3).'

gh issue create --label "$LABELS" \
  --title "Replace the hardcoded 8192 max_tokens fallback with a named constant" \
  --body $'All three real providers repeat `req.max_tokens || 8192`. One named constant removes the magic number.\n\n**Files.** `packages/proxy/src/providers/anthropic.ts`, `bedrock.ts`, `openai-compatible.ts`.\n\n**Do.** Define one constant (for example exported from `packages/proxy/src/providers/index.ts`) and import it into all three. No behaviour change: the default stays 8192.\n\n**Done when** the three providers reference one shared constant. Offline mock loop green, `npm test` passes.\n\nFull detail: `docs/launch/good-first-issues.md` (#4).'

gh issue create --label "$LABELS" \
  --title 'Make the "no staged edits" backend error read in English' \
  --body $'Both backends throw a German-only string when `create_merge_request` runs with nothing staged, while the surrounding code is English.\n\n**Files.** `packages/gitlab-client/src/backend.ts` and `packages/github-client/src/backend.ts` (the guard in `createMergeRequest`); `packages/gitlab-client/test/backend.test.ts` and `packages/github-client/test/backend.test.ts` (both assert `/Keine vorgeschlagenen/`).\n\n**Do.** Give both backends the same English message and update the two tests.\n\n**Done when** both backends throw the same English message and both tests assert it. Offline mock loop green, `npm test` passes.\n\nFull detail: `docs/launch/good-first-issues.md` (#5).'

gh issue create --label "$LABELS" \
  --title "Add a test for the GitHub root-commit revert guard" \
  --body $'GitHub revert is a simplified tree swap. `revertViaBranch` refuses a commit with no parent (a root commit) with a clear error. The happy path is tested; the guard is not.\n\n**Files.** `packages/github-client/src/client.ts` (`revertViaBranch`, the no-parent guard), `packages/github-client/test/client.test.ts` (add a case beside the existing revert describe block).\n\n**Do.** Drive `revertViaBranch` against a commit whose detail reports no parent, using the existing request-router pattern. Assert it rejects with the root-commit message and issues no branch-create call.\n\n**Done when** the guard has a test that fails without it. Offline mock loop green, `npm test` passes.\n\nFull detail: `docs/launch/good-first-issues.md` (#6).'

echo "Opened 6 good-first-issues with labels: $LABELS"

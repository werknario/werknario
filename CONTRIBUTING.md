# Contributing

The three most common contributions are a new model, a new provider, or a
backend fix. Each one is small and lives in a predictable place. Start here,
then read the setup sections below if you need them.

## Add a backend, a provider, or a model

werknario is provider-agnostic and backend-agnostic on purpose. Adding a
choice should not touch the agent loop.

### A model

A new model is one entry in `packages/shared/src/models.ts`, plus a test.
A `ModelSpec` has eight required fields, and a literal copy only compiles if
you set all of them: `id` (the canonical catalog key), `label` (a
human-readable name), `provider` (`anthropic`, `bedrock`,
`openai-compatible`, or `mock`), `match` (the patterns that map a raw
provider model id back to this entry), `contextWindow`, `supportsTools`,
`dataResidency` (`eu`, `self-host`, or `non-eu`), and `price` (a `ModelPrice`
object with `inputPerMTok`, `outputPerMTok`, and `verifiedOn` — optionally
`cacheWritePerMTok`, `cacheReadPerMTok`, and `note` — or `null` if you cannot
verify it; a bare `price: 3` does not compile). The quickest path is to copy an
existing entry and change all eight. Nothing else in the agent needs to
change: the token ledger and the router both read this catalog. The model registry is
`packages/shared/src/models.ts`. It is not the `registry/` package, which is
the unrelated gallery-proxy service.

Two rules the existing entries already follow, and yours must too:

- Price is the list price on a stated `verifiedOn` date. If you cannot verify
  it, set `price: null` rather than guessing. The Bedrock EU regional
  surcharge is not baked in; it is applied at estimate time.
- The residency flag is a property of the route, not the model family. A
  self-host or EU-hosted route matches only its explicit canonical id, so a
  bare provider id falls back to the non-EU direct entry and gets treated as
  non-EU. That fail-safe is deliberate. Keep it.

Add a matching assertion to `packages/shared/test/models.test.ts`: the
residency flag, `isEuSafe(id)`, and a cost check via
`estimateCostUsd(...)` for priced models. If the model can carry personal
data, prove it is `eu` or `self-host` and that a raw provider id does not
resolve to a non-EU entry by accident.

See [docs/providers-and-models.md](docs/providers-and-models.md) for the
catalog and how residency feeds the router.

### A provider

A provider turns one model request into one model response over a specific
wire format. The existing ones are in `packages/proxy/src/providers/`:
`mock`, `anthropic`, `bedrock`, and one generic `openai-compatible`.

Most new endpoints do not need new code. The `openai-compatible` provider
already reaches any OpenAI-style chat-completions endpoint (Mistral, Kimi,
DeepSeek, Qwen, a self-hosted vLLM/SGLang server) through
`LLM_OPENAI_COMPAT_BASE_URL`, `LLM_OPENAI_COMPAT_API_KEY`, and `LLM_MODEL`.
For those you add a model entry (above) and set env vars. No provider code.

A genuinely new wire format is a new file in `packages/proxy/src/providers/`
that returns a `Provider` (`createMessage(req)`), wired into
`createProvider()` in `packages/proxy/src/providers/index.ts`, with the new
name added to `ProviderName` and `ProxyConfig` in
`packages/proxy/src/config.ts` and to `ProviderKind` in
`packages/shared/src/models.ts`.

### A backend

A backend is where a diff becomes a merge or pull request. The details live
in `packages/gitlab-client` and `packages/github-client`; both implement the
same `ToolBackend` interface (`backend.ts`), with the REST specifics in
`client.ts`. Fix a quirk of one host there, not in the shared core. Note that
the GitHub revert is a simplified tree swap, not a three-way git revert.

See [docs/backends.md](docs/backends.md) for what each backend supports.

### Before you open the PR

Run the offline mock loop. It needs no key and no server and is fully
deterministic, so it is the fastest way to confirm your change did not break
the read to propose to approve to merge path:

```bash
npm run build
npm run demo
```

A green run reads a note, proposes a new split-sheet file, opens
`mock://merge-request/1`, merges it, and ends with an audit line that reports
the chain verified. The narration comes out in German because the bundled
demo substrate is a German-language music label. The language follows the
content the agent reads; it is not a language flag you can set. To run
against your own content, point it at a different repository (see
[docs/configuration.md](docs/configuration.md)). Then run `npm test` and
`npm run typecheck` (below), and add a test for the new behavior.

## Prerequisites

- Node.js 20 or newer (`engines.node` in `package.json`).
- npm. This is an npm workspaces monorepo, so there is no separate package
  manager or lockfile tool to install.

## Install

```bash
npm install
```

This installs and links every workspace: `packages/*` and `registry`. The
first install pulls the whole build chain and takes a few minutes, and it
prints npm audit advisories that all come from dev-only tooling
(esbuild/vite/vitest). `npm audit --omit=dev` reports 0 vulnerabilities, so
nothing in the shipped CLI is affected.

## Run tests

```bash
npm test
```

Runs `npm run test --workspaces --if-present`: every workspace with a `test`
script runs its Vitest suite. To run just one package:

```bash
npm test -w @werknario/cli
npm test -w @werknario/shared
```

Tests live in each package's own `test/` directory, next to that package's
`src/`, not in a shared top-level test folder. `e2e/` is the one exception, a
separate cross-package suite covered below.

## Typecheck

```bash
npm run typecheck
```

Runs `tsc --noEmit` in strict mode (`tsconfig.base.json`:
`noUncheckedIndexedAccess`, `noImplicitOverride`, `strict`) across every
workspace with a `typecheck` script.

## Build

```bash
npm run build
```

The root script builds, in order: `@werknario/shared`,
`@werknario/gitlab-client`, `@werknario/github-client`, `@werknario/proxy`,
`@werknario/cli`, then the extension package `werknario-webide-agent`.
`@werknario/registry` (the gallery-proxy service) is the only workspace not in
that aggregate; build it directly if you need it:

```bash
npm run build -w @werknario/registry
```

One quirk worth knowing. `shared`, `proxy`, and `registry` compile to
`dist/` on build, matching their `package.json` `main`/`types`.
`gitlab-client` and `github-client` set `"noEmit": true` in their
`tsconfig.json`, so their `build` script only typechecks and produces no
`dist/`. That does not block the CLI or the extension, because both bundle
every workspace package straight from TypeScript source via esbuild path
aliases (`packages/cli/esbuild.mjs`, `packages/extension/esbuild.mjs`), never
from a dependency's compiled `dist/`. It would only matter if you tried to
`import "@werknario/gitlab-client"` from outside the bundle expecting `npm run
build` to have emitted something importable. Right now it has not. Worth
fixing upstream by dropping `noEmit` from those two `tsconfig.json` files.

## Run the offline demo

Same command as the pre-PR check above, no credentials and no server:

```bash
npm install
npm run build
npm run demo
```

Heads-up: the run narrates in German because the bundled demo substrate is a
German-language music label. That is the content, not a language flag.

During iteration you can skip the build and run the source directly with
`npm run dev -w @werknario/cli -- "..."` (it runs `tsx src/cli.ts`). Verify a
past run's log without re-running anything:

```bash
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

`verify` exits 0 on an intact chain and non-zero if the chain breaks. It is a
hash chain, not a signature, and it cannot detect tail truncation on its own;
the chain head is stamped into the merge request to anchor it on the server.

See [docs/backends.md](docs/backends.md) for what the mock backend seeds and
[docs/configuration.md](docs/configuration.md) for every other run mode.

## Code style and testing conventions

New behavior gets a failing test before the implementation that makes it
pass. The existing suites (`packages/*/test/`) are the reference shape: a
scripted mock LLM caller and a scripted tool executor/backend for unit tests,
not live network calls.

Strict TypeScript everywhere (`tsconfig.base.json`). Do not relax `strict`,
`noUncheckedIndexedAccess`, or `noImplicitOverride` for a single package
without a specific reason documented in that package's `tsconfig.json`.

`e2e/` is separate from the per-package unit tests. `flagship.test.ts` is
deterministic (mock backend, mock provider) and always runs.
`flagship-real-llm.test.ts` needs `CLAUDE_API_TOKEN` and `RUN_REAL_LLM=1`;
`flagship-live.test.ts` needs a reachable real GitLab instance. Both skip
automatically when their environment is not set, so `npm test` and CI stay
deterministic and secret-free by default. Run them explicitly with:

```bash
cd e2e && npx vitest run
```

For integration-style testing against a real GitLab,
`infra/local-gitlab/boot-all.sh` boots a loopback-bound GitLab CE instance and
mints a token. See [docs/DEMO.md](docs/DEMO.md).

Commit messages read like a person who did the work wrote them: no AI or model
attribution, no co-author lines referencing an AI tool. Follow the tone of the
existing git log.

## Sign your commits (DCO)

This project uses the Developer Certificate of Origin. Sign off every commit:

```bash
git commit -s
```

The `-s` appends a `Signed-off-by: Your Name <you@example.com>` line. It
certifies that you wrote the change, or have the right to submit it, under the
project's Apache-2.0 license. Unsigned commits are not merged. If you forgot,
amend with `git commit --amend -s`.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By taking part
you agree to uphold it. Report conduct concerns to jonah@grosshanten.com.

## Workspace structure

```
packages/
  shared/          provider-agnostic core: agent loop, tool executor, audit log,
                    permission model, model registry (src/models.ts), token ledger, router
  gitlab-client/    GitLab REST client + ToolBackend implementation
  github-client/    GitHub REST + Git Data API client + ToolBackend implementation
  proxy/            standalone LLM gateway (mock/anthropic/bedrock/openai-compatible)
  cli/              the CLI (bin: werknario)
  extension/        VS Code Web IDE extension for the GitLab Web IDE
registry/           gallery-proxy service for private Web IDE extension distribution
e2e/                cross-package flagship tests
infra/local-gitlab/ local GitLab CE via Docker Compose, for integration testing
docs/               configuration, backends, providers, audit, permissions, architecture
```

See [docs/architecture-and-status.md](docs/architecture-and-status.md) for
what each package does in more depth, and an honest split of what runs today
versus what is still planned.

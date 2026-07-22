# Contributing

## Prerequisites

- Node.js 20 or newer (`engines.node` in `package.json`).
- npm. This is an npm workspaces monorepo, so there's no separate package
  manager or lockfile tool to install.

## Install

```bash
npm install
```

This installs and links every workspace: `packages/*` and `registry`.

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

Tests live in each package's own `test/` directory, next to the package's
`src/`, not in a shared top-level test folder. `e2e/` is the one exception,
a separate cross-package suite covered below.

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

The root script runs, in order: `@werknario/shared` build, `@werknario/gitlab-client`
build, `@werknario/proxy` build, `@werknario/cli` build, then the extension
package `werknario-webide-agent` build. `@werknario/github-client` and
`@werknario/registry` are not part of that root aggregate; build them
directly if you need to:

```bash
npm run build -w @werknario/github-client
npm run build -w @werknario/registry
```

One gap worth knowing about: `shared`, `proxy`, and `registry` each run
`tsc -p tsconfig.json` as their `build` script, and their `tsconfig.json` has
no `noEmit`, so that step really does compile to `dist/`, matching their
`package.json` `main`/`types` fields. `gitlab-client` and `github-client` also
run `tsc -p tsconfig.json` as `build`, but their `tsconfig.json` sets
`"noEmit": true`, so running their `build` script only typechecks. It does
not produce a `dist/` directory, even though their `package.json` also points
`main`/`types` at `./dist/...`. In practice this doesn't block the CLI or the
extension, since both bundle every workspace package straight from its
TypeScript source via `esbuild` path aliases (see `packages/cli/esbuild.mjs`
and `packages/extension/esbuild.mjs`), never from a workspace dependency's
compiled `dist/` output. It would matter if you tried to `import
"@werknario/gitlab-client"` or `"@werknario/github-client"` from outside this
bundle (a separate script, a published package) expecting `npm run build` to
have produced something importable. Right now it hasn't. This is worth fixing
upstream, either drop `noEmit` from those two `tsconfig.json` files or point
their `build` script somewhere that actually emits, rather than working
around it per consumer.

## Run the offline demo

No credentials, no server, fully deterministic:

```bash
npm install
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  npm run dev -w @werknario/cli -- "Draft the split sheet from the session note" --yes
```

`npm run dev` in `packages/cli` runs `tsx src/cli.ts` directly, no build step
needed. To run the built binary instead:

```bash
npm run build
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

See [`docs/backends.md`](./docs/backends.md) for what the mock backend seeds
and [`docs/configuration.md`](./docs/configuration.md) for every other run
mode.

## Code style and testing conventions

New behavior gets a failing test before the implementation that makes it
pass. This repo's existing suites (`packages/*/test/`) are the reference for
the expected shape: a scripted mock LLM caller and a scripted tool
executor/backend, not live network calls, for unit tests.

Strict TypeScript everywhere (`tsconfig.base.json`). Don't relax `strict`,
`noUncheckedIndexedAccess`, or `noImplicitOverride` for a single package
without a specific reason documented in that package's `tsconfig.json`.

`e2e/` is separate from the per-package unit tests. `flagship.test.ts` is
deterministic (mock backend, mock provider) and always runs.
`flagship-real-llm.test.ts` needs `CLAUDE_API_TOKEN` and `RUN_REAL_LLM=1`;
`flagship-live.test.ts` needs a reachable real GitLab instance. Both skip
automatically when their environment isn't set, so `npm test` and CI stay
deterministic and secret-free by default. Run them explicitly with:

```bash
cd e2e && npx vitest run
```

For integration-style testing against a real GitLab,
`infra/local-gitlab/boot-all.sh` boots a loopback-bound GitLab CE instance
and mints a token. See `docs/DEMO.md`.

Commit messages read like they were written by a person who did the work: no
AI or model attribution, no co-author lines referencing an AI tool. Follow
the tone of the existing git log.

## Workspace structure

```
packages/
  shared/          provider-agnostic core: agent loop, tool executor, audit log,
                    permission model, model registry, token ledger, router
  gitlab-client/    GitLab REST client + ToolBackend implementation
  github-client/    GitHub REST + Git Data API client + ToolBackend implementation
  proxy/            standalone LLM gateway (mock/anthropic/bedrock/openai-compatible)
  cli/              the `werknario` command
  extension/        VS Code web extension for the GitLab Web IDE
registry/           gallery-proxy service for private Web IDE extension distribution
e2e/                cross-package flagship tests
infra/local-gitlab/ local GitLab CE via Docker Compose, for integration testing
docs/               configuration, backends, providers, audit, permissions, architecture
```

See [`docs/architecture-and-status.md`](./docs/architecture-and-status.md)
for what each package does in more depth, and an honest split of what runs
today versus what's still planned.

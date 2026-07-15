# Web extension host test (`@vscode/test-web`)

`suite/extension.test.ts` holds the checks that genuinely need a real browser VS
Code extension host: that the extension activates, registers `werknario.openChat`,
and that `workspace.fs` round-trips a write/read. This is the in-browser
counterpart to Spike A/D from the werknario spikes.

## Status

Scaffolded, not yet wired to a runner. Running it needs a browser mocha bundle
(`suite/index.ts` exporting `run()`) built to `dist/test/suite/index.js`, then:

```bash
npx vscode-test-web --headless --browserType=chromium \
  --extensionDevelopmentPath=. \
  --extensionTestsPath=./dist/test/suite/index.js \
  ./test-fixtures/workspace
```

It downloads a VS Code web build and a headless Chromium on first run. Follow the
`microsoft/vscode-test-web` "web-extension" sample for the mocha-in-browser runner
bundle (webpack `require.context` or an esbuild entry that sets up mocha TDD mode
and imports the test files after `mocha.setup`).

## Why it isn't the primary proof

The extension is already verified three other ways that don't need this download:
the esbuild browser bundle builds against `platform: browser` with `vscode`
external (so it's a valid Web Worker extension); the vscode-independent logic is
unit-tested (`packages/extension/test/units.test.ts`); and the full agent
pipeline is exercised end-to-end against a real Claude model
(`e2e/flagship-real-llm.test.ts`). This harness closes the last gap — activation
inside a real headless web host — and is the recommended next automated check.

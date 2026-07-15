# werknario Web-IDE agent

A web-native AI agent for the GitLab Web IDE. It runs in the browser (no terminal,
no local install), reads the document substrate, proposes an edit as a diff, and
opens a merge request for a human to approve. The GitLab CI validates the change.
The agent has no hands to run anything itself; CI is its hand.

This is the werknario core made live: **AI proposes, human approves, CI executes.**

## Why it exists

None of the common AI coding agents run in the GitLab Web IDE (they are desktop
extensions and need a terminal). The Web IDE is a Web Worker extension host: no
Node, no filesystem, no shell. That is exactly what suits werknario, where the
agent should never execute anything directly.

Phase 0 spikes (in the werknario repo, `docs/spikes/`) confirmed the four load-
bearing facts: the Web IDE exposes an `api`-scoped auth token to extensions; the
extension host can `fetch` an external proxy; a private extension can be
distributed via a self-hosted Open VSX registry; and the Web IDE's own commit is
the same REST endpoint we drive.

## Architecture

```
  ┌─────────────────────── GitLab Web IDE (browser) ───────────────────────┐
  │  Extension (Web Worker host)                                            │
  │   • webview chat panel                                                  │
  │   • agent loop (from @shared) — drives Claude's tool-use turns          │
  │   • tool executor: workspace.fs (read/list/diff) + GitLab REST (MR)     │
  │   • auth: vscode.authentication.getSession('gitlab-web-ide', ['api'])   │
  └──────────────┬───────────────────────────────┬────────────────────────┘
                 │ fetch (bearer)                 │ fetch (user's GitLab token)
                 ▼                                ▼
        ┌──────────────────┐            ┌──────────────────────┐
        │  LLM proxy (EU)  │            │  GitLab REST API      │
        │  thin gateway    │            │  branch/commit/MR     │
        │  Bedrock EU      │            │  (CI validates)       │
        └──────────────────┘            └──────────────────────┘
```

The proxy holds the model credentials and never sees the GitLab token. The GitLab
token stays in the browser and never reaches the proxy. The agent loop and every
tool run inside the extension.

## Packages

| Package | What |
|---|---|
| `packages/shared` | Message + tool types, tool schemas, the pure agent loop (provider-agnostic, fully unit-tested) |
| `packages/gitlab-client` | GitLab REST client (`fetch`-based, browser + node) and the tool implementations |
| `packages/proxy` | Stateless LLM gateway: pluggable providers (mock / anthropic / bedrock), CORS, bearer auth |
| `packages/extension` | VS Code web extension: webview chat, tool executor, auth, distribution manifest |

## Develop

```bash
npm install
npm run test        # unit tests across shared / gitlab-client / proxy
npm run build
```

Local GitLab for integration tests (matches the real instance version):

```bash
bash infra/local-gitlab/boot-all.sh     # boots GitLab CE 18.0.2 on :9180, mints a token
```

## Status

Built head-to-toe in one session against a local GitLab. See `NIGHT-LOG.md` for
what is proven, what is mocked, and what still needs real credentials
(AWS Bedrock EU) and the real instance (Web IDE distribution).

# Night log — werknario Web-IDE agent build

One autonomous session, 2026-07-15 night. Goal: build the feature head to toe and
test every layer that can be driven deterministically without the live instance
(which is updating) and without AWS Bedrock credentials (not available).

## Ground rules honored
- Live instance gitlab.xconcapps.de untouched (it is updating).
- No AWS/Anthropic creds present → LLM path is a pluggable provider with a
  deterministic mock for tests; real Bedrock/Anthropic wired behind env placeholders.
- Commits as a human developer, no AI mention.

## What each layer is tested against
- `shared` agent loop: unit tests with a scripted mock LLM + mock tool executor.
- `gitlab-client`: unit tests vs an in-process mock GitLab server, plus integration
  vs local GitLab CE 18.0.2 in Docker.
- `proxy`: HTTP tests incl. CORS preflight (Spike B contract) with the mock provider.
- `extension`: integration tests in a real headless browser VS Code via
  `@vscode/test-web` (real web extension host — no GitLab needed for these).
- Flagship e2e: session note → split-sheet draft → MR, driven end to end against
  local GitLab with the mock LLM producing the tool calls.

## Honest gaps (need you / the real instance)
- Real LLM reasoning: needs AWS Bedrock EU creds. The loop + tool-use wiring is
  proven with the mock; swapping in the real provider is one env change.
- Real Web IDE click-through on gitlab.xconcapps.de: needs the instance back up and
  the extension distributed (Spike C recipe). `@vscode/test-web` covers the
  extension-host behaviors in the meantime.
- Self-hosted Open VSX registry: infra decision pending your sign-off (ADMIN.md).

## What got built (all committed)
- `shared` — message/tool types, the five tool schemas, the German system prompt, the pure agent loop, the `ToolBackend` interface + tool executor with the human-approval gate and path-traversal guard. 27 tests.
- `gitlab-client` — fetch-based GitLab REST client (browser + node) and `GitLabRestBackend`. 16 tests.
- `proxy` — stateless LLM gateway: mock / anthropic / bedrock providers, CORS + preflight, bearer auth (constant-time). 15 tests.
- `extension` — VS Code web-extension: webview chat, `VSCodeBackend`, Web-IDE auth (`getSession('gitlab-web-ide')`) with PAT fallback, proxy client, cross-message conversation memory. 13 tests. Builds to a 33 KB browser bundle via esbuild.
- `e2e` — flagship "session note → split sheet → merge request": one deterministic run (mock GitLab + in-process proxy) and one against a REAL Claude model.
- `infra/local-gitlab` — GitLab CE 18.0.2 compose + token bootstrap (loopback-bound).
- `.gitlab-ci.yml` — build + typecheck + test on every push.

## Proven this session
- 71 unit tests + typecheck clean across all four packages.
- Flagship pipeline works end-to-end with the **mock** brain (deterministic) AND with a **real Claude Sonnet 5** (~27 s): the model read the note, drafted the split sheet, committed it, and opened a merge request through the entire real pipeline (loop → HTTP proxy → Anthropic API → tool-use → executor → GitLab backend/client). Only the model and the GitLab server were simulated in the deterministic run; the real run simulated only the GitLab server.
- Security review (independent) + code review (independent) run; both must-fix correctness bugs and the HIGH security finding fixed and covered by new tests.

## Honest gaps (need you / the real instance)
- **Local GitLab did not come up.** The `gitlab/gitlab-ce:18.0.2-ce.0` image is amd64-only; under arm64 emulation on this Mac it never served HTTP in ~20 min. The guarded `e2e/flagship-live.test.ts` runs the *same* flow against a real GitLab and is ready — point it at a native-arm64 GitLab (or the real instance once it's back) and it seeds a throwaway project and asserts a real MR. To retry locally: use a GitLab image with an arm64 manifest, or run the live test against gitlab.xconcapps.de directly.
- **Real Web IDE click-through** on gitlab.xconcapps.de: still needs the instance up + the extension distributed (Spike C). `@vscode/test-web` (scaffolded in `packages/extension/test-web/`) is the automated stand-in for the extension-host behaviors and is the recommended next check.
- **Bedrock EU** (production LLM path): wired behind env placeholders, not exercised (no AWS creds). The real Anthropic token proved the loop; swapping to the Bedrock EU provider is one env change + adding `@anthropic-ai/bedrock-sdk`.
- Deferred review nits (documented, not blocking): mock provider treats any tool_result as success (#4, test-only); `requireString` rejects intentionally-empty content (#7); `thinking:disabled` hardcoded (fine for Sonnet 5 / Opus, would 400 on Fable 5) (#8); `list_files` sees staged edits in the Web IDE backend but not the REST backend (#9).

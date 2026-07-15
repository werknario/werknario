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

## Progress
- [in progress] scaffold + shared + gitlab-client + proxy + extension + e2e + review
(updated as the session runs)

# Demo & run guide

The flagship: in the GitLab Web IDE, ask the agent "entwirf aus der Session-Notiz
ein Split Sheet". It reads the note, writes a draft (shown as a diff), you approve,
it opens a merge request. CI validates. No terminal.

## Run the tests

```bash
npm install
npm run test          # 71 unit tests: shared, gitlab-client, proxy, extension
npm run typecheck
(cd e2e && npx vitest run)   # flagship pipeline; live-GitLab test skips without one
```

## See the whole pipeline with a real Claude model (~30s)

Needs a Claude API token in the environment.

```bash
cd e2e
CLAUDE_API_TOKEN=sk-ant-... RUN_REAL_LLM=1 npx vitest run flagship-real-llm
```

This starts the proxy (anthropic provider) in-process and drives the real agent
loop against an in-memory GitLab. The model actually reads the note, drafts the
split sheet, commits it, and opens a merge request. Watch it call the tools.

## Run the agent against a REAL GitLab

The deterministic tests simulate GitLab. To hit a real instance:

1. Start the proxy (mock brain is fine for a scripted demo; anthropic/bedrock for a real one):
   ```bash
   cd packages/proxy
   LLM_PROVIDER=anthropic CLAUDE_API_TOKEN=sk-ant-... \
   PROXY_BEARER_TOKEN=<random> PROXY_PORT=9109 npm run dev
   ```
2. Point the live e2e at a reachable GitLab (native-arm64 image, or the real instance):
   ```bash
   # after infra/local-gitlab/boot-all.sh has minted a token, OR set the token yourself
   cd e2e && GITLAB_LOCAL_URL=https://gitlab.xconcapps.de npx vitest run flagship-live
   ```
   It seeds a throwaway project with the session note and asserts a real MR appears.

## Run the extension in the actual Web IDE

1. Distribute it: the full recipe lives in [`DISTRIBUTION.md`](DISTRIBUTION.md) —
   a gallery-proxy registry (`registry/`) serves our extension and passes
   everything else through to open-vsx.org; the instance marketplace points at it
   via `preset=custom`. Deploys automatically from main (`deploy:registry`).
2. In the Web IDE, open Settings and fill: `werknario.proxyUrl`, `werknario.proxyToken`,
   `werknario.gitlabBaseUrl`, `werknario.projectId`. The GitLab token comes from the
   Web IDE session automatically (Spike A) — no PAT needed unless the session path fails.
3. Run "Fleetlicht KI: Chat öffnen", type the flagship prompt, approve the MR.

## Local GitLab note

`infra/local-gitlab/` boots GitLab CE 18.0.2. On Apple Silicon the pinned image is
amd64-only and crawls under emulation — use an image with an arm64 manifest, or run
against the real instance. The compose file binds to loopback only.

## The keynote beat

Show the same task twice: the old way (someone hand-writes the split sheet, emails
it around, chases the missing share) and the new way (ask the agent, it drafts from
the real note, you approve, the MR carries the audit trail, the open share is marked
`ANTEIL OFFEN` because the agent doesn't invent it). The point is not that the AI is
clever — it's that the proposal is visible, approvable, and logged.

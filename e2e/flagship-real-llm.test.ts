import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  createToolExecutor,
  runAgentLoop,
  TOOL_DEFINITIONS,
  type Message,
} from "@werknario/shared";
import { GitlabClient, GitLabRestBackend, type FetchLike } from "@werknario/gitlab-client";
import { createApp } from "../packages/proxy/src/app.js";
import { createAnthropicProvider } from "../packages/proxy/src/providers/anthropic.js";
import { createProxyCaller } from "../packages/extension/src/proxyClient.js";

/**
 * The flagship flow with a REAL Claude model (not the deterministic mock brain).
 * Proves the anthropic provider, the tool schemas, and the loop actually drive a
 * live model end to end. Opt-in — needs a network + a key, so it is skipped
 * unless RUN_REAL_LLM=1 and a token is present. Run with:
 *   RUN_REAL_LLM=1 CLAUDE_API_TOKEN=... npx vitest run flagship-real-llm
 */

const enabled =
  process.env.RUN_REAL_LLM === "1" &&
  !!(process.env.CLAUDE_API_TOKEN || process.env.ANTHROPIC_API_KEY);

const SESSION_NOTE = "mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md";
const NOTE_BODY = [
  "# Session-Notiz Landgang — 2026-05-30",
  "",
  "Titel: „Landgang“ (Arbeitstitel).",
  "Anwesend und Beiträge:",
  "- Marit Detert — Text und Melodie",
  "- Piotr Kwaśniewski — Produktion, Arrangement",
  "- Ole Ottkamp — Gitarre (Session-Musiker, Anteil noch offen, Kontakt läuft)",
  "",
  "Nächster Schritt: Split Sheet aufsetzen, Ottkamp-Anteil klären.",
].join("\n");

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function makeGitlabDouble(): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const respond = (status: number, payload: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return typeof payload === "string" ? payload : JSON.stringify(payload);
      },
      async json() {
        return payload;
      },
    });
    if (method === "GET" && /\/projects\/[^/]+$/.test(url))
      return respond(200, {
        id: 124,
        path_with_namespace: "x-concapps/fleetlicht-demo",
        default_branch: "main",
        visibility: "private",
      });
    if (method === "GET" && url.includes("/repository/files/")) {
      if (url.includes(encodeURIComponent(SESSION_NOTE))) return respond(200, NOTE_BODY);
      return respond(404, "not found");
    }
    if (method === "GET" && url.includes("/repository/tree"))
      return respond(200, [
        { id: "1", name: "session-notiz_landgang_2026-05-30.md", type: "blob", path: SESSION_NOTE },
      ]);
    if (method === "POST" && url.includes("/repository/branches"))
      return respond(201, { name: body?.branch ?? "split/x" });
    if (method === "POST" && url.includes("/repository/commits"))
      return respond(201, { id: "c1", short_id: "c1", web_url: "http://gitlab.mock/c1" });
    if (method === "POST" && url.includes("/merge_requests"))
      return respond(201, {
        iid: 1,
        web_url: "http://gitlab.mock/-/merge_requests/1",
        source_branch: body?.source_branch ?? "split/x",
        target_branch: "main",
        title: body?.title ?? "",
      });
    return respond(500, `unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

let server: Server;
let proxyUrl: string;
const BEARER = "real-llm-bearer";

beforeAll(async () => {
  if (!enabled) return;
  const app = createApp({
    provider: createAnthropicProvider({
      provider: "anthropic",
      model: process.env.LLM_MODEL || "claude-sonnet-5",
      bearerToken: BEARER,
      port: 0,
      allowedOrigins: "*",
      anthropic: { apiKey: process.env.CLAUDE_API_TOKEN || process.env.ANTHROPIC_API_KEY },
      bedrock: { region: undefined, accessKeyId: undefined, secretAccessKey: undefined },
    }),
    providerName: "anthropic",
    model: process.env.LLM_MODEL || "claude-sonnet-5",
    bearerToken: BEARER,
    allowedOrigins: "*",
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  proxyUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

(enabled ? describe : describe.skip)("flagship with a REAL Claude model", () => {
  it(
    "drives read -> propose -> merge request on a live model",
    async () => {
      const { fetchImpl, calls } = makeGitlabDouble();
      const client = new GitlabClient({
        baseUrl: "http://gitlab.mock",
        token: "user-token",
        projectId: 124,
        fetchImpl,
      });
      const backend = new GitLabRestBackend(client);
      await backend.init();
      const executeTool = createToolExecutor(backend); // auto-approve for the smoke
      const callLlm = createProxyCaller({ url: proxyUrl, token: BEARER });

      const messages: Message[] = [
        {
          role: "user",
          content:
            `Lies die Datei ${SESSION_NOTE}. Entwirf daraus mit propose_edit ein Split Sheet als ` +
            `neue Markdown-Datei unter mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md ` +
            `(Beteiligte, Rollen, Anteile; unklare Anteile als „ANTEIL OFFEN“ markieren). ` +
            `Öffne danach mit create_merge_request einen Merge Request gegen main. ` +
            `Arbeite autonom und frag nicht nach.`,
        },
      ];

      const result = await runAgentLoop(messages, {
        system: buildSystemPrompt({ projectPath: "x-concapps/fleetlicht-demo", defaultBranch: "main" }),
        tools: TOOL_DEFINITIONS,
        callLlm,
        executeTool,
        maxTurns: 12,
      });

      // The model actually read the note
      expect(calls.some((c) => c.method === "GET" && c.url.includes("/repository/files/"))).toBe(true);
      // ...committed a split sheet...
      const commit = calls.find((c) => c.url.includes("/repository/commits"));
      expect(commit, "the model should have committed a proposed edit").toBeDefined();
      const actions = (commit?.body as { actions: Array<{ content: string; file_path: string }> }).actions;
      expect(actions[0]?.content.toLowerCase()).toContain("split");
      // ...and opened a merge request.
      expect(calls.some((c) => c.url.includes("/merge_requests") && c.method === "POST")).toBe(true);
      expect(result.stopped).toBe("end_turn");
    },
    120000,
  );
});

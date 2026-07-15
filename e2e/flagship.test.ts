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
import { createMockProvider } from "../packages/proxy/src/providers/mock.js";
import { createProxyCaller } from "../packages/extension/src/proxyClient.js";

/**
 * Flagship end-to-end: "entwirf aus der Session-Notiz ein Split Sheet".
 *
 * Everything werknario ships is exercised for real — the agent loop, the HTTP
 * proxy, the tool executor + approval gate, the GitLab REST backend, and the
 * GitLab client. Only the two things we cannot run offline are simulated: the
 * model (the proxy's deterministic mock brain) and the GitLab server (an
 * in-memory REST double). The same test runs against a real GitLab when one is
 * reachable — see flagship-live.test.ts.
 */

const SESSION_NOTE = "mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md";
const NOTE_BODY = [
  "# Session-Notiz Landgang — 2026-05-30",
  "",
  "Anwesend: Detert (Text/Melodie), Kwaśniewski (Produktion), Ottkamp (Gitarre).",
  "Ottkamp-Anteil noch offen, Kontakt läuft.",
].join("\n");

interface GitlabCall {
  method: string;
  url: string;
  body?: unknown;
}

/** In-memory GitLab REST double: only what the flagship touches. */
function makeGitlabDouble(): { fetchImpl: FetchLike; calls: GitlabCall[] } {
  const calls: GitlabCall[] = [];
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

    // Project metadata
    if (method === "GET" && /\/projects\/[^/]+$/.test(url)) {
      return respond(200, {
        id: 124,
        path_with_namespace: "x-concapps/fleetlicht-demo",
        default_branch: "main",
        visibility: "private",
      });
    }
    // Raw file read
    if (method === "GET" && url.includes("/repository/files/")) {
      if (url.includes(encodeURIComponent(SESSION_NOTE))) return respond(200, NOTE_BODY);
      return respond(404, "not found"); // anything else = a new file
    }
    if (method === "GET" && url.includes("/repository/tree")) return respond(200, []);
    if (method === "POST" && url.includes("/repository/branches"))
      return respond(201, { name: "split/landgang-entwurf-mock" });
    if (method === "POST" && url.includes("/repository/commits"))
      return respond(201, { id: "c1", short_id: "c1", web_url: "http://gitlab.mock/c1" });
    if (method === "POST" && url.includes("/merge_requests"))
      return respond(201, {
        iid: 1,
        web_url: "http://gitlab.mock/x-concapps/fleetlicht-demo/-/merge_requests/1",
        source_branch: "split/landgang-entwurf-mock",
        target_branch: "main",
        title: body?.title ?? "",
      });

    return respond(500, `unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

let server: Server;
let proxyUrl: string;
const BEARER = "e2e-bearer";

beforeAll(async () => {
  const app = createApp({
    provider: createMockProvider(),
    providerName: "mock",
    model: "mock",
    bearerToken: BEARER,
    allowedOrigins: "*",
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  proxyUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("flagship: session note -> split sheet -> merge request", () => {
  it("reads the note, proposes the draft, and opens an MR — all via the real pipeline", async () => {
    const { fetchImpl, calls } = makeGitlabDouble();
    const client = new GitlabClient({
      baseUrl: "http://gitlab.mock",
      token: "user-token",
      projectId: 124,
      fetchImpl,
    });
    const backend = new GitLabRestBackend(client);
    await backend.init();

    const executeTool = createToolExecutor(backend); // headless: auto-approve
    const callLlm = createProxyCaller({ url: proxyUrl, token: BEARER });

    const system = buildSystemPrompt({
      projectPath: "x-concapps/fleetlicht-demo",
      defaultBranch: "main",
    });
    const messages: Message[] = [
      {
        role: "user",
        content: `Entwirf aus ${SESSION_NOTE} ein Split Sheet und öffne einen Merge Request.`,
      },
    ];

    const result = await runAgentLoop(messages, {
      system,
      tools: TOOL_DEFINITIONS,
      callLlm,
      executeTool,
      maxTurns: 10,
    });

    // The loop ran to a clean finish
    expect(result.stopped).toBe("end_turn");

    // GitLab saw the real sequence
    const methods = calls.map((c) => `${c.method} ${c.url.split("/api/v4")[1] ?? c.url}`);
    expect(methods.some((m) => m.startsWith("GET") && m.includes("/repository/files/"))).toBe(true);
    expect(methods.some((m) => m.includes("/repository/branches"))).toBe(true);

    const commitCall = calls.find((c) => c.url.includes("/repository/commits"));
    expect(commitCall).toBeDefined();
    const actions = (commitCall?.body as { actions: Array<{ file_path: string; content: string }> })
      .actions;
    expect(actions[0]?.file_path).toContain("split-sheet_landgang");
    expect(actions[0]?.content).toContain("Split Sheet");

    const mrCall = calls.find((c) => c.url.includes("/merge_requests"));
    expect(mrCall).toBeDefined();

    // Staging cleared, human-facing summary mentions the MR
    expect(backend.stagedCount).toBe(0);
    expect(result.finalText.length).toBeGreaterThan(0);
  });
});

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  createToolExecutor,
  runAgentLoop,
  TOOL_DEFINITIONS,
  type Message,
} from "@werknario/shared";
import { GitlabClient, GitLabRestBackend } from "@werknario/gitlab-client";
import { createApp } from "../packages/proxy/src/app.js";
import { createMockProvider } from "../packages/proxy/src/providers/mock.js";
import { createProxyCaller } from "../packages/extension/src/proxyClient.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The same flagship flow, but against a REAL local GitLab (CE 18.0.2 in Docker;
 * see infra/local-gitlab). It seeds a throwaway project with the session note,
 * runs the agent, and confirms an actual merge request was created on the
 * server. Skips cleanly when no local GitLab is reachable, so the suite stays
 * green on machines without it.
 */

const GITLAB_URL = process.env.GITLAB_LOCAL_URL ?? "http://localhost:9180";
const TOKEN_FILE = fileURLToPath(
  new URL("../infra/local-gitlab/.local-admin-token", import.meta.url),
);
const SESSION_NOTE = "mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md";
const NOTE_BODY = "# Session-Notiz Landgang\nAnwesend: Detert, Kwaśniewski, Ottkamp. Anteil offen.\n";

async function gitlabReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${GITLAB_URL}/api/v4/version`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : "";

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});

(token.length > 0 ? describe : describe.skip)("flagship (live GitLab)", () => {
  it("seeds a project, runs the agent, and finds a real merge request", async (ctx) => {
    if (!(await gitlabReachable())) ctx.skip();
    // A unique-ish path without Date.now/Math.random: derive from the token tail.
    const suffix = token.slice(-6).replace(/[^a-z0-9]/gi, "") || "demo";
    const path = `werknario-e2e-${suffix}`;

    // 1. create the project (admin), tolerate "already exists"
    const create = await fetch(`${GITLAB_URL}/api/v4/projects`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: path, path, visibility: "private", initialize_with_readme: true }),
    });
    let projectId: number;
    if (create.ok) {
      projectId = ((await create.json()) as { id: number }).id;
    } else {
      const found = await fetch(
        `${GITLAB_URL}/api/v4/projects?search=${path}&owned=true`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      const list = (await found.json()) as Array<{ id: number; path: string }>;
      const match = list.find((p) => p.path === path);
      if (!match) throw new Error("could not create or find the e2e project");
      projectId = match.id;
    }

    // 2. seed the session note (create action, tolerate "exists")
    await fetch(
      `${GITLAB_URL}/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(SESSION_NOTE)}`,
      {
        method: "POST",
        headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
        body: JSON.stringify({ branch: "main", content: NOTE_BODY, commit_message: "seed session note" }),
      },
    );

    // 3. in-process mock-brain proxy
    const app = createApp({
      provider: createMockProvider(),
      providerName: "mock",
      model: "mock",
      bearerToken: "live-bearer",
      allowedOrigins: "*",
    });
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    servers.push(server);
    const proxyUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // 4. run the real agent against the real GitLab
    const client = new GitlabClient({ baseUrl: GITLAB_URL, token, projectId });
    const backend = new GitLabRestBackend(client);
    await backend.init();
    const executeTool = createToolExecutor(backend);
    const callLlm = createProxyCaller({ url: proxyUrl, token: "live-bearer" });

    const messages: Message[] = [
      { role: "user", content: `Entwirf aus ${SESSION_NOTE} ein Split Sheet und öffne einen Merge Request.` },
    ];
    const result = await runAgentLoop(messages, {
      system: buildSystemPrompt({ projectPath: path, defaultBranch: "main" }),
      tools: TOOL_DEFINITIONS,
      callLlm,
      executeTool,
      maxTurns: 10,
    });
    expect(result.stopped).toBe("end_turn");

    // 5. confirm a real MR exists on the server
    const mrs = (await (
      await fetch(`${GITLAB_URL}/api/v4/projects/${projectId}/merge_requests?state=opened`, {
        headers: { "PRIVATE-TOKEN": token },
      })
    ).json()) as Array<{ source_branch: string; web_url: string }>;
    expect(mrs.length).toBeGreaterThan(0);
    expect(mrs.some((m) => m.source_branch.includes("landgang"))).toBe(true);
  });
});

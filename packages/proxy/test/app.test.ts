import { describe, expect, it } from "vitest";
import request from "supertest";
import type { LlmRequest, LlmResponse, Message, ToolResultBlock, ToolUseBlock } from "@werknario/shared";
import { createApp } from "../src/app.js";
import { createMockProvider } from "../src/providers/mock.js";
import type { Provider } from "../src/providers/index.js";

const BEARER = "test-bearer-token";

function buildApp(overrides?: { provider?: Provider }) {
  return createApp({
    provider: overrides?.provider ?? createMockProvider(),
    providerName: "mock",
    model: "claude-sonnet-5",
    bearerToken: BEARER,
    allowedOrigins: "*",
  });
}

function firstToolUse(response: LlmResponse): ToolUseBlock {
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`expected a tool_use block, got: ${JSON.stringify(response.content)}`);
  }
  return block;
}

function toolResultFor(toolUse: ToolUseBlock, content = "ok"): ToolResultBlock {
  return { type: "tool_result", tool_use_id: toolUse.id, content };
}

describe("GET /health", () => {
  it("returns 200 with status ok and the provider name", async () => {
    const app = buildApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.provider).toBe("mock");
    expect(res.body.model).toBe("claude-sonnet-5");
  });
});

describe("POST /v1/agent/message auth", () => {
  it("rejects a request with no Authorization header", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/v1/agent/message")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", "Bearer wrong-token")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
  });

  it("carries the CORS header on a 401 response", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/v1/agent/message")
      .set("Origin", "https://example.test")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe("https://example.test");
  });

  it("rejects a body without a messages array", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ system: "no messages here" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("OPTIONS preflight", () => {
  it("returns 204 with the required CORS headers on the agent endpoint", async () => {
    const app = buildApp();
    const res = await request(app)
      .options("/v1/agent/message")
      .set("Origin", "https://example.test")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://example.test");
    expect(res.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(res.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type");
    expect(res.headers["access-control-max-age"]).toBe("86400");
  });

  it("returns 204 on an arbitrary path too", async () => {
    const app = buildApp();
    const res = await request(app).options("/health").set("Origin", "https://example.test");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://example.test");
  });
});

describe("CORS on success responses", () => {
  it("carries the CORS header on a 200 response", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .set("Origin", "https://example.test")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://example.test");
  });
});

describe("POST /v1/agent/message with the mock provider", () => {
  it("starts the flagship flow with a read_file tool_use", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({
        messages: [
          {
            role: "user",
            content:
              "entwirf ein Split Sheet aus vertraege/session-notiz_landgang_2026-05-30.md",
          },
        ],
      } satisfies LlmRequest);

    expect(res.status).toBe(200);
    const body = res.body as LlmResponse;
    expect(body.stop_reason).toBe("tool_use");
    expect(body.role).toBe("assistant");
    const toolUse = firstToolUse(body);
    expect(toolUse.name).toBe("read_file");
  });

  it("drives read_file -> propose_edit -> create_merge_request -> end_turn across turns", async () => {
    const app = buildApp();
    const messages: Message[] = [
      {
        role: "user",
        content:
          "entwirf ein Split Sheet aus vertraege/session-notiz_landgang_2026-05-30.md",
      },
    ];

    // Turn 1: read_file
    let res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ messages } satisfies LlmRequest);
    expect(res.status).toBe(200);
    let body = res.body as LlmResponse;
    expect(body.stop_reason).toBe("tool_use");
    let toolUse = firstToolUse(body);
    expect(toolUse.name).toBe("read_file");

    messages.push({ role: "assistant", content: body.content });
    messages.push({
      role: "user",
      content: [toolResultFor(toolUse, "# Session-Notiz\n...")],
    });

    // Turn 2: propose_edit
    res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ messages } satisfies LlmRequest);
    expect(res.status).toBe(200);
    body = res.body as LlmResponse;
    expect(body.stop_reason).toBe("tool_use");
    toolUse = firstToolUse(body);
    expect(toolUse.name).toBe("propose_edit");

    messages.push({ role: "assistant", content: body.content });
    messages.push({ role: "user", content: [toolResultFor(toolUse, "ok")] });

    // Turn 3: create_merge_request
    res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ messages } satisfies LlmRequest);
    expect(res.status).toBe(200);
    body = res.body as LlmResponse;
    expect(body.stop_reason).toBe("tool_use");
    toolUse = firstToolUse(body);
    expect(toolUse.name).toBe("create_merge_request");

    messages.push({ role: "assistant", content: body.content });
    messages.push({ role: "user", content: [toolResultFor(toolUse, "MR !42 opened")] });

    // Turn 4: final text, end_turn
    res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ messages } satisfies LlmRequest);
    expect(res.status).toBe(200);
    body = res.body as LlmResponse;
    expect(body.stop_reason).toBe("end_turn");
    expect(body.content.some((b) => b.type === "text")).toBe(true);
  });
});

describe("POST /v1/agent/message provider errors", () => {
  it("returns 502 without leaking the error detail when the provider throws", async () => {
    const failingProvider: Provider = {
      async createMessage() {
        throw new Error("secret-api-key-leak-should-not-appear");
      },
    };
    const app = buildApp({ provider: failingProvider });
    const res = await request(app)
      .post("/v1/agent/message")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret-api-key-leak-should-not-appear");
  });
});

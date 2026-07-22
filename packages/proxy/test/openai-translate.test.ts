import { describe, expect, it } from "vitest";
import type { Message, ToolDefinition } from "@werknario/shared";
import {
  fromOpenAiResponse,
  toOpenAiMessages,
  toOpenAiTools,
} from "../src/providers/openai-translate.js";

describe("toOpenAiMessages", () => {
  it("prepends the system prompt as a system message", () => {
    const out = toOpenAiMessages("du bist der agent", [
      { role: "user", content: "hallo" },
    ]);
    expect(out[0]).toEqual({ role: "system", content: "du bist der agent" });
    expect(out[1]).toEqual({ role: "user", content: "hallo" });
  });

  it("turns an assistant tool_use into an OpenAI tool_call with stringified args", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "ich lese" },
          { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.md" } },
        ],
      },
    ];
    const out = toOpenAiMessages(undefined, messages);
    const asst = out[0] as {
      role: string;
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    expect(asst.role).toBe("assistant");
    expect(asst.content).toBe("ich lese");
    expect(asst.tool_calls?.[0]?.id).toBe("t1");
    expect(asst.tool_calls?.[0]?.function.name).toBe("read_file");
    expect(JSON.parse(asst.tool_calls?.[0]?.function.arguments ?? "{}")).toEqual({
      path: "a.md",
    });
  });

  it("turns a tool_result block into its own tool-role message", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "L1: inhalt" },
        ],
      },
    ];
    const out = toOpenAiMessages(undefined, messages);
    expect(out[0]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      content: "L1: inhalt",
    });
  });
});

describe("toOpenAiTools", () => {
  it("maps a werknario tool definition to the OpenAI function shape", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read_file",
        description: "liest eine Datei",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ];
    const out = toOpenAiTools(tools);
    expect(out[0]).toEqual({
      type: "function",
      function: {
        name: "read_file",
        description: "liest eine Datei",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    });
  });
});

describe("fromOpenAiResponse", () => {
  it("maps a text answer and end_turn", () => {
    const r = fromOpenAiResponse({
      id: "x",
      model: "mistral-large-3",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "fertig" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    expect(r.stop_reason).toBe("end_turn");
    expect(r.content).toEqual([{ type: "text", text: "fertig" }]);
    expect(r.usage).toEqual({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: undefined });
    expect(r.model).toBe("mistral-large-3");
  });

  it("maps tool_calls to tool_use blocks with parsed input and tool_use stop", () => {
    const r = fromOpenAiResponse({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.md"}' } },
            ],
          },
        },
      ],
    });
    expect(r.stop_reason).toBe("tool_use");
    expect(r.content).toEqual([
      { type: "tool_use", id: "c1", name: "read_file", input: { path: "a.md" } },
    ]);
  });

  it("survives malformed tool arguments without throwing", () => {
    const r = fromOpenAiResponse({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{not json" } }],
          },
        },
      ],
    });
    expect(r.content[0]).toMatchObject({ type: "tool_use", name: "x", input: {} });
  });

  it("reads a cache hit and subtracts it from input_tokens (no double-count)", () => {
    const r = fromOpenAiResponse({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    });
    // OpenAI's cached_tokens is a subset of prompt_tokens. werknario's cost model
    // wants input_tokens = the non-cached remainder, so cached tokens are not
    // charged once at full price AND once at cache price.
    expect(r.usage?.cache_read_input_tokens).toBe(80);
    expect(r.usage?.input_tokens).toBe(20);
    expect(r.usage?.output_tokens).toBe(5);
  });
});

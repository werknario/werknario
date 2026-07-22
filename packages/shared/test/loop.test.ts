import { describe, expect, it, vi } from "vitest";
import {
  runAgentLoop,
  type LlmResponse,
  type Message,
  type ToolExecutionResult,
  type ToolUseBlock,
} from "../src/index.js";

/** Build a scripted caller that returns the given responses in order. */
function scriptedCaller(responses: LlmResponse[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i];
    if (!r) throw new Error(`caller invoked more times (${i + 1}) than scripted (${responses.length})`);
    i += 1;
    return r;
  });
}

function text(t: string): LlmResponse {
  return { role: "assistant", content: [{ type: "text", text: t }], stop_reason: "end_turn" };
}

function toolCall(name: string, input: Record<string, unknown>, id = "tu_1", say?: string): LlmResponse {
  const content = [];
  if (say) content.push({ type: "text" as const, text: say });
  content.push({ type: "tool_use" as const, id, name, input });
  return { role: "assistant", content, stop_reason: "tool_use" };
}

const baseOpts = {
  system: "sys",
  tools: [],
};

describe("runAgentLoop", () => {
  it("returns immediately when the model ends its turn with no tool call", async () => {
    const callLlm = scriptedCaller([text("Fertig.")]);
    const executeTool = vi.fn();
    const res = await runAgentLoop([{ role: "user", content: "hallo" }], {
      ...baseOpts,
      callLlm,
      executeTool,
    });
    expect(res.stopped).toBe("end_turn");
    expect(res.finalText).toBe("Fertig.");
    expect(res.turns).toBe(1);
    expect(executeTool).not.toHaveBeenCalled();
    // messages: initial user + assistant
    expect(res.messages).toHaveLength(2);
    expect(res.messages[1]?.role).toBe("assistant");
  });

  it("executes a tool then finishes on the next turn", async () => {
    const callLlm = scriptedCaller([
      toolCall("read_file", { path: "a.md" }, "tu_read"),
      text("Ich habe die Datei gelesen."),
    ]);
    const executeTool = vi.fn(
      async (): Promise<ToolExecutionResult> => ({ content: "file contents" }),
    );
    const res = await runAgentLoop([{ role: "user", content: "lies a.md" }], {
      ...baseOpts,
      callLlm,
      executeTool,
    });
    expect(res.stopped).toBe("end_turn");
    expect(res.finalText).toBe("Ich habe die Datei gelesen.");
    expect(res.turns).toBe(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    const arg = executeTool.mock.calls[0]?.[0] as ToolUseBlock;
    expect(arg.name).toBe("read_file");
    expect(arg.input).toEqual({ path: "a.md" });
    // messages: user, assistant(tool_use), user(tool_result), assistant(text)
    expect(res.messages).toHaveLength(4);
    const toolResultMsg = res.messages[2];
    expect(toolResultMsg?.role).toBe("user");
    expect(Array.isArray(toolResultMsg?.content)).toBe(true);
  });

  it("executes multiple tool_use blocks in one turn and returns one tool_result message", async () => {
    const multi: LlmResponse = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "a", name: "read_file", input: { path: "a.md" } },
        { type: "tool_use", id: "b", name: "read_file", input: { path: "b.md" } },
      ],
      stop_reason: "tool_use",
    };
    const callLlm = scriptedCaller([multi, text("done")]);
    const executeTool = vi.fn(async () => ({ content: "x" }));
    const res = await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    const toolResultMsg = res.messages[2];
    expect(Array.isArray(toolResultMsg?.content)).toBe(true);
    const blocks = toolResultMsg?.content as { tool_use_id: string }[];
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.tool_use_id).sort()).toEqual(["a", "b"]);
  });

  it("turns a thrown tool error into an error tool_result and keeps going", async () => {
    const callLlm = scriptedCaller([
      toolCall("read_file", { path: "missing.md" }, "tu_err"),
      text("Konnte nicht lesen, alles gut."),
    ]);
    const executeTool = vi.fn(async () => {
      throw new Error("404 not found");
    });
    const res = await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
    });
    expect(res.stopped).toBe("end_turn");
    const toolResultMsg = res.messages[2];
    const blocks = toolResultMsg?.content as { is_error?: boolean; content: string }[];
    expect(blocks[0]?.is_error).toBe(true);
    expect(blocks[0]?.content).toContain("404 not found");
  });

  it("stops at maxTurns when the model never ends its turn", async () => {
    // caller always asks for a tool
    const callLlm = vi.fn(async () => toolCall("list_files", {}, "loop"));
    const executeTool = vi.fn(async () => ({ content: "[]" }));
    const res = await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
      maxTurns: 3,
    });
    expect(res.stopped).toBe("max_turns");
    expect(res.turns).toBe(3);
    expect(callLlm).toHaveBeenCalledTimes(3);
    // executes on turns 1 and 2, then stops before executing on turn 3
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("keeps a valid transcript when stopping at maxTurns (every tool_use is paired)", async () => {
    const callLlm = vi.fn(async () => toolCall("list_files", {}, "loop"));
    const executeTool = vi.fn(async () => ({ content: "[]" }));
    const res = await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
      maxTurns: 2,
    });
    expect(res.stopped).toBe("max_turns");
    const last = res.messages[res.messages.length - 1];
    expect(last?.role).toBe("user");
    const blocks = last?.content as Array<{ type: string; tool_use_id: string }>;
    expect(blocks.every((b) => b.type === "tool_result")).toBe(true);
    expect(blocks[0]?.tool_use_id).toBe("loop");
  });

  it("treats stop_reason=tool_use with no tool_use blocks as end_turn (no infinite loop)", async () => {
    const malformed: LlmResponse = {
      role: "assistant",
      content: [{ type: "text", text: "hmm" }],
      stop_reason: "tool_use",
    };
    const callLlm = scriptedCaller([malformed]);
    const executeTool = vi.fn();
    const res = await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
    });
    expect(res.stopped).toBe("end_turn");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("emits lifecycle events in order", async () => {
    const callLlm = scriptedCaller([
      toolCall("read_file", { path: "a.md" }, "tu1", "Ich lese jetzt."),
      text("Fertig."),
    ]);
    const executeTool = vi.fn(async () => ({ content: "data" }));
    const seq: string[] = [];
    await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
      events: {
        onTurn: (n) => seq.push(`turn:${n}`),
        onAssistantText: (t) => seq.push(`text:${t}`),
        onToolUse: (b) => seq.push(`use:${b.name}`),
        onToolResult: (b) => seq.push(`result:${b.name}`),
      },
    });
    expect(seq).toEqual([
      "turn:1",
      "text:Ich lese jetzt.",
      "use:read_file",
      "result:read_file",
      "turn:2",
      "text:Fertig.",
    ]);
  });

  it("passes system, tools and model through to the caller", async () => {
    const callLlm = scriptedCaller([text("ok")]);
    await runAgentLoop([{ role: "user", content: "go" }], {
      system: "SYSTEM",
      tools: [
        { name: "read_file", description: "d", input_schema: { type: "object", properties: {} } },
      ],
      model: "test-model",
      callLlm,
      executeTool: vi.fn(),
    });
    const req = (callLlm.mock.calls[0] as unknown[])[0] as {
      system: string;
      model: string;
      tools: unknown[];
    };
    expect(req.system).toBe("SYSTEM");
    expect(req.model).toBe("test-model");
    expect(req.tools).toHaveLength(1);
  });
});

/** A model turn that also reports token usage. */
function textWithUsage(
  t: string,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): LlmResponse {
  return {
    role: "assistant",
    content: [{ type: "text", text: t }],
    stop_reason: "end_turn",
    model,
    usage,
  };
}

describe("runAgentLoop — token accounting and budget gate", () => {
  it("records usage into the running totals and fires onUsage", async () => {
    const callLlm = scriptedCaller([
      textWithUsage("fertig", "claude-haiku-4-5", {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ]);
    const onUsage = vi.fn();
    const res = await runAgentLoop([{ role: "user", content: "hi" }], {
      ...baseOpts,
      callLlm,
      executeTool: vi.fn(),
      events: { onUsage },
    });
    expect(res.usage.calls).toBe(1);
    expect(res.usage.inputTokens).toBe(1_000_000);
    expect(res.usage.costUsd).toBeCloseTo(6.0, 6); // haiku $1 in + $5 out
    expect(onUsage).toHaveBeenCalledOnce();
  });

  it("stops with stopped:'budget' when the gate trips, without executing the pending tool", async () => {
    const expensive: LlmResponse = {
      role: "assistant",
      content: [{ type: "tool_use", id: "t", name: "read_file", input: { path: "a.md" } }],
      stop_reason: "tool_use",
      model: "claude-opus-4-8",
      usage: { input_tokens: 0, output_tokens: 1_000_000 }, // opus $25
    };
    const callLlm = scriptedCaller([expensive, text("unreached")]);
    const executeTool = vi.fn(async () => ({ content: "x" }));
    const res = await runAgentLoop([{ role: "user", content: "go" }], {
      ...baseOpts,
      callLlm,
      executeTool,
      budgetGate: (totals) => (totals.costUsd >= 5 ? "stop" : "continue"),
    });
    expect(res.stopped).toBe("budget");
    expect(res.turns).toBe(1);
    expect(executeTool).not.toHaveBeenCalled();
    // transcript stays valid: the pending tool_use gets a paired tool_result
    const last = res.messages[res.messages.length - 1];
    expect(last?.role).toBe("user");
  });

  it("uses selectModelForTurn to override the model for the next turn", async () => {
    const callLlm = scriptedCaller([text("ok")]);
    await runAgentLoop([{ role: "user", content: "hi" }], {
      ...baseOpts,
      model: "claude-sonnet-5",
      callLlm,
      executeTool: vi.fn(),
      selectModelForTurn: () => "claude-haiku-4-5",
    });
    const req = callLlm.mock.calls[0]?.[0] as { model: string };
    expect(req.model).toBe("claude-haiku-4-5");
  });
});

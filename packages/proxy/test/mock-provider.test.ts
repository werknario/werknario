import { describe, expect, it } from "vitest";
import type { LlmRequest, Message, ToolUseBlock } from "@werknario/shared";
import { createMockProvider } from "../src/providers/mock.js";

function toolUseOf(content: LlmRequest["messages"][number]["content"]): ToolUseBlock {
  const blocks = Array.isArray(content) ? content : [];
  const found = blocks.find((b) => b.type === "tool_use");
  if (!found || found.type !== "tool_use") throw new Error("no tool_use block found");
  return found;
}

describe("mock provider", () => {
  it("extracts the path mentioned in the user's message for read_file", async () => {
    const provider = createMockProvider();
    const res = await provider.createMessage({
      messages: [
        {
          role: "user",
          content: "bitte lies vertraege/session-notiz_landgang_2026-05-30.md",
        },
      ],
    });
    const toolUse = toolUseOf(res.content);
    expect(toolUse.name).toBe("read_file");
    expect(toolUse.input.path).toBe("vertraege/session-notiz_landgang_2026-05-30.md");
  });

  it("falls back to the default path when no path is mentioned", async () => {
    const provider = createMockProvider();
    const res = await provider.createMessage({
      messages: [{ role: "user", content: "mach mal was" }],
    });
    const toolUse = toolUseOf(res.content);
    expect(toolUse.input.path).toBe(
      "mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md"
    );
  });

  it("produces deterministic, non-random tool_use ids", async () => {
    const provider = createMockProvider();
    const messages: Message[] = [{ role: "user", content: "entwirf ein Split Sheet" }];

    const first = await provider.createMessage({ messages });
    const again = await provider.createMessage({ messages });

    expect(first.content).toEqual(again.content);
  });

  it("every tool_use response reports stop_reason tool_use", async () => {
    const provider = createMockProvider();
    const res = await provider.createMessage({
      messages: [{ role: "user", content: "entwirf ein Split Sheet" }],
    });
    expect(res.stop_reason).toBe("tool_use");
    expect(res.role).toBe("assistant");
  });
});

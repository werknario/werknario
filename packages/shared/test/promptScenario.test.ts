import { describe, expect, it } from "vitest";
import {
  buildScenarioMessages,
  buildScenarioRequest,
  textOf,
  toolCallsOf,
  type LlmResponse,
} from "../src/index.js";

describe("promptScenario", () => {
  it("injects each read as a synthetic read_file tool_use + line-numbered result", () => {
    const messages = buildScenarioMessages({
      task: "Erstelle das Split-Sheet",
      reads: { "vertraege/notiz.md": "Beteiligte: Ottkamp, Voss." },
    });
    expect(messages[0]).toEqual({ role: "user", content: "Erstelle das Split-Sheet" });
    // assistant tool_use read_file
    const asst = messages[1];
    expect(Array.isArray(asst?.content)).toBe(true);
    expect((asst?.content as unknown[])[0]).toMatchObject({ type: "tool_use", name: "read_file" });
    // user tool_result with line numbers
    const result = messages[2];
    const block = (result?.content as Array<{ content: string }>)[0];
    expect(block?.content).toContain("L1: Beteiligte: Ottkamp, Voss.");
  });

  it("builds a request with the real system prompt and tools", () => {
    const req = buildScenarioRequest({ task: "x", locale: "en" });
    expect(req.system).toContain("[Beleg:"); // the citation contract is present
    expect((req.tools ?? []).some((t) => t.name === "read_file")).toBe(true);
  });

  it("extracts tool calls and text from a response", () => {
    const response: LlmResponse = {
      role: "assistant",
      content: [
        { type: "text", text: "Ich schlage vor." },
        { type: "tool_use", id: "a", name: "add_comment", input: { body: "x" } },
      ],
      stop_reason: "tool_use",
    };
    expect(textOf(response)).toBe("Ich schlage vor.");
    expect(toolCallsOf(response)).toEqual([{ name: "add_comment", input: { body: "x" } }]);
  });
});

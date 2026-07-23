import { describe, expect, it } from "vitest";
import type { LlmRequest, LlmResponse, Message, ToolUseBlock } from "@werknario/shared";
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

describe("mock provider — fabricated-citation demo path", () => {
  // Drives the mock turn by turn, standing in for the tool executor: a
  // create_merge_request whose description carries a [Beleg:] citation comes
  // back as a grounding error (is_error), exactly as executor.ts does for a
  // citation to a file that was never read.
  async function drive(task: string): Promise<LlmResponse[]> {
    const provider = createMockProvider();
    const messages: Message[] = [{ role: "user", content: task }];
    const outputs: LlmResponse[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await provider.createMessage({ messages });
      outputs.push(res);
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason === "end_turn") break;
      const tu = toolUseOf(res.content);
      const fabricated =
        tu.name === "create_merge_request" &&
        String((tu.input as Record<string, unknown>).description ?? "").includes("[Beleg:");
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: tu.id,
            content: fabricated
              ? "Der Merge Request wurde NICHT geöffnet. Die Belege stimmen nicht."
              : "ok",
            is_error: fabricated,
          },
        ],
      });
    }
    return outputs;
  }

  it("cites a file it never read at the merge-request step, so the gate can block it", async () => {
    const outputs = await drive(
      "Draft the split sheet from the session note, but add a fabricated citation to show the gate",
    );
    const mr = outputs.find((o) =>
      o.content.some((b) => b.type === "tool_use" && b.name === "create_merge_request"),
    );
    expect(mr).toBeDefined();
    const tu = toolUseOf(mr!.content);
    expect(String(tu.input.description)).toContain("[Beleg: vertraege/fees.csv");
  });

  it("ends cleanly after the block instead of retrying (no loop)", async () => {
    const outputs = await drive(
      "Draft the split sheet but add a fabricated citation to show the gate",
    );
    const last = outputs[outputs.length - 1]!;
    expect(last.stop_reason).toBe("end_turn");
    expect(
      last.content.some((b) => b.type === "text" && b.text.includes("MR refused")),
    ).toBe(true);
    const mrAttempts = outputs.filter((o) =>
      o.content.some((b) => b.type === "tool_use" && b.name === "create_merge_request"),
    ).length;
    expect(mrAttempts).toBe(1);
  });

  it("leaves the happy path unchanged when the marker is absent", async () => {
    const provider = createMockProvider();
    const messages: Message[] = [
      { role: "user", content: "entwirf ein Split Sheet" },
      { role: "assistant", content: [{ type: "tool_use", id: "mock_read_file_1", name: "read_file", input: { path: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "mock_read_file_1", content: "ok" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "mock_propose_edit_2", name: "propose_edit", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "mock_propose_edit_2", content: "ok" }] },
    ];
    const res = await provider.createMessage({ messages });
    const tu = toolUseOf(res.content);
    expect(tu.name).toBe("create_merge_request");
    expect(String(tu.input.description)).not.toContain("[Beleg:");
  });
});

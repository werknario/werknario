import { describe, expect, it } from "vitest";
import { createMockProvider } from "@werknario/proxy";
import { runScenario, SCENARIOS } from "../src/eval.js";

describe("eval harness", () => {
  it("the split-sheet scenario passes end to end against the mock provider", async () => {
    const provider = createMockProvider();
    const scenario = SCENARIOS[0]!;
    const result = await runScenario(scenario, (req) => provider.createMessage(req));
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("reports a failing check instead of throwing when the outcome is wrong", async () => {
    // A caller that just ends the turn without doing anything fails the checks.
    const idleCaller = async () => ({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "nichts zu tun" }],
      stop_reason: "end_turn",
    });
    const result = await runScenario(SCENARIOS[0]!, idleCaller);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => !c.ok)).toBe(true);
  });
});

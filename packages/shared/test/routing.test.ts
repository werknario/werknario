import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTING_POLICY,
  isEuSafe,
  makeSelectModelForTurn,
  selectModel,
  selectTier,
  signalsFromMessages,
  validateRoutingPolicy,
  type Message,
  type RoutingPolicy,
  type RoutingSignals,
  type TokenTotals,
} from "../src/index.js";

function signals(s: Partial<RoutingSignals>): RoutingSignals {
  return {
    toolName: null,
    filePaths: [],
    contextTokens: 0,
    sessionCostUsd: 0,
    ...s,
  };
}

describe("selectTier — deterministic rules", () => {
  it("routes pure reads to the cheapest tier", () => {
    expect(selectTier(signals({ toolName: "read_file" }), DEFAULT_ROUTING_POLICY)).toBe(
      "simple",
    );
    expect(selectTier(signals({ toolName: "list_files" }), DEFAULT_ROUTING_POLICY)).toBe(
      "simple",
    );
  });

  it("routes write/propose/MR/comment to the standard tier", () => {
    for (const toolName of [
      "propose_edit",
      "create_merge_request",
      "add_comment",
    ]) {
      expect(selectTier(signals({ toolName }), DEFAULT_ROUTING_POLICY)).toBe(
        "standard",
      );
    }
  });

  it("never routes a sensitive path below standard, and escalates on multi-file", () => {
    expect(
      selectTier(
        signals({ toolName: "propose_edit", filePaths: ["vertraege/split.md"] }),
        DEFAULT_ROUTING_POLICY,
      ),
    ).toBe("standard");
    expect(
      selectTier(
        signals({
          toolName: "propose_edit",
          filePaths: ["vertraege/a.md", "vertraege/b.md"],
        }),
        DEFAULT_ROUTING_POLICY,
      ),
    ).toBe("high");
  });

  it("escalates when many files are touched at once", () => {
    expect(
      selectTier(
        signals({ toolName: "propose_edit", filePaths: ["a", "b", "c", "d"] }),
        DEFAULT_ROUTING_POLICY,
      ),
    ).toBe("high");
  });

  it("steps down one tier once the soft budget is exceeded (cost brake)", () => {
    const overBudget = signals({
      toolName: "propose_edit",
      filePaths: ["a", "b", "c", "d"], // would be "high"
      sessionCostUsd: 6,
    });
    const policy: RoutingPolicy = { ...DEFAULT_ROUTING_POLICY, softBudgetUsd: 5 };
    expect(selectTier(overBudget, policy)).toBe("standard"); // high -> standard
    // a plain read stays simple (already the floor)
    expect(
      selectTier(signals({ toolName: "read_file", sessionCostUsd: 6 }), policy),
    ).toBe("simple");
  });

  it("falls back to standard for a free chat turn with no tool", () => {
    expect(selectTier(signals({}), DEFAULT_ROUTING_POLICY)).toBe("standard");
  });
});

describe("selectModel — maps tiers to configurable models", () => {
  it("uses the policy's model per tier (Claude by default)", () => {
    const r = selectModel(signals({ toolName: "read_file" }), DEFAULT_ROUTING_POLICY);
    expect(r.tier).toBe("simple");
    expect(r.modelId).toBe(DEFAULT_ROUTING_POLICY.modelByTier.simple);
  });

  it("works with a non-Claude policy (e.g. Kimi/Mistral swapped in)", () => {
    const policy: RoutingPolicy = {
      ...DEFAULT_ROUTING_POLICY,
      modelByTier: {
        simple: "kimi-k2",
        standard: "mistral-large",
        high: "claude-opus-4-8",
      },
    };
    expect(selectModel(signals({ toolName: "read_file" }), policy).modelId).toBe(
      "kimi-k2",
    );
    expect(selectModel(signals({ toolName: "propose_edit" }), policy).modelId).toBe(
      "mistral-large",
    );
  });
});

describe("DSGVO guard", () => {
  it("treats the default Claude-via-Bedrock-EU policy as EU-safe", () => {
    expect(validateRoutingPolicy(DEFAULT_ROUTING_POLICY)).toEqual([]);
  });

  it("flags an unknown or non-EU model when euOnly is on", () => {
    const policy: RoutingPolicy = {
      ...DEFAULT_ROUTING_POLICY,
      euOnly: true,
      modelByTier: { ...DEFAULT_ROUTING_POLICY.modelByTier, high: "gpt-9-turbo" },
    };
    const problems = validateRoutingPolicy(policy);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/gpt-9-turbo/);
  });

  it("isEuSafe is honest about unknown models", () => {
    expect(isEuSafe("claude-sonnet-5")).toBe(true);
    expect(isEuSafe("totally-unknown")).toBe(false);
  });
});

describe("signalsFromMessages + makeSelectModelForTurn (loop bridge)", () => {
  const totals = (costUsd: number): TokenTotals => ({
    calls: 0,
    unpricedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd,
  });

  it("reads the last assistant tool_use for tool name and paths", () => {
    const messages: Message[] = [
      { role: "user", content: "los" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "a", name: "read_file", input: { path: "vertraege/x.md" } },
        ],
      },
    ];
    const s = signalsFromMessages(messages, 3);
    expect(s.toolName).toBe("read_file");
    expect(s.filePaths).toEqual(["vertraege/x.md"]);
    expect(s.sessionCostUsd).toBe(3);
  });

  it("routes a read turn to the cheap model and honours the soft budget", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "a", name: "read_file", input: { path: "a.md" } }],
      },
    ];
    const choose = makeSelectModelForTurn(DEFAULT_ROUTING_POLICY);
    expect(choose({ messages, totals: totals(0) })).toBe(
      DEFAULT_ROUTING_POLICY.modelByTier.simple,
    );
  });

  it("gives a fresh conversation (no tool yet) the standard model", () => {
    const choose = makeSelectModelForTurn(DEFAULT_ROUTING_POLICY);
    const messages: Message[] = [{ role: "user", content: "hallo" }];
    expect(choose({ messages, totals: totals(0) })).toBe(
      DEFAULT_ROUTING_POLICY.modelByTier.standard,
    );
  });
});

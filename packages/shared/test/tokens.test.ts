import { describe, expect, it } from "vitest";
import {
  TokenLedger,
  canonicalModelId,
  estimateCostUsd,
  getModel,
  type LlmUsage,
} from "../src/index.js";

const M = 1_000_000;

function usage(u: Partial<LlmUsage>): LlmUsage {
  return { input_tokens: 0, output_tokens: 0, ...u };
}

describe("model registry", () => {
  it("knows the verified Anthropic models with EU data residency via Bedrock", () => {
    const sonnet = getModel("claude-sonnet-5");
    expect(sonnet).toBeDefined();
    expect(sonnet?.supportsTools).toBe(true);
    // Anthropic via Bedrock EU is a self-host-free EU path.
    expect(sonnet?.price?.inputPerMTok).toBe(2);
  });

  it("maps a full Bedrock model id back to its canonical price key", () => {
    expect(canonicalModelId("eu.anthropic.claude-sonnet-5-20250101-v1:0")).toBe(
      "claude-sonnet-5",
    );
    expect(canonicalModelId("anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(
      "claude-haiku-4-5",
    );
    expect(canonicalModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(canonicalModelId("something-unknown")).toBeUndefined();
  });
});

describe("estimateCostUsd — verified Anthropic prices (Stand 2026-07-22)", () => {
  it("prices Haiku input at $1 / MTok", () => {
    const r = estimateCostUsd(usage({ input_tokens: M }), "claude-haiku-4-5");
    expect(r.priceUnknown).toBe(false);
    expect(r.costUsd).toBeCloseTo(1.0, 6);
  });

  it("prices Haiku output at $5 / MTok", () => {
    const r = estimateCostUsd(usage({ output_tokens: M }), "claude-haiku-4-5");
    expect(r.costUsd).toBeCloseTo(5.0, 6);
  });

  it("prices a cache read at 0.1x input (Haiku $0.10 / MTok)", () => {
    const r = estimateCostUsd(
      usage({ cache_read_input_tokens: M }),
      "claude-haiku-4-5",
    );
    expect(r.costUsd).toBeCloseTo(0.1, 6);
  });

  it("prices a cache write at 1.25x input (Haiku $1.25 / MTok)", () => {
    const r = estimateCostUsd(
      usage({ cache_creation_input_tokens: M }),
      "claude-haiku-4-5",
    );
    expect(r.costUsd).toBeCloseTo(1.25, 6);
  });

  it("adds a 10% premium for the Bedrock EU regional endpoint", () => {
    const r = estimateCostUsd(usage({ input_tokens: M }), "claude-haiku-4-5", {
      bedrockEu: true,
    });
    expect(r.costUsd).toBeCloseTo(1.1, 6);
  });

  it("prices Sonnet 5 at the introductory $2/$10 and resolves a full Bedrock id", () => {
    const r = estimateCostUsd(
      usage({ input_tokens: M, output_tokens: M }),
      "eu.anthropic.claude-sonnet-5-20250101-v1:0",
    );
    expect(r.costUsd).toBeCloseTo(12.0, 6);
  });

  it("does not fabricate a cost for an unknown model", () => {
    const r = estimateCostUsd(usage({ input_tokens: M }), "gpt-9-turbo");
    expect(r.priceUnknown).toBe(true);
    expect(r.costUsd).toBe(0);
  });
});

describe("TokenLedger", () => {
  it("accumulates tokens and cost across turns and models", () => {
    const ledger = new TokenLedger();
    ledger.record(usage({ input_tokens: M, output_tokens: M }), "claude-haiku-4-5"); // 1 + 5 = 6
    ledger.record(usage({ input_tokens: M }), "claude-sonnet-5"); // 2
    const t = ledger.totals();
    expect(t.calls).toBe(2);
    expect(t.inputTokens).toBe(2 * M);
    expect(t.outputTokens).toBe(M);
    expect(t.costUsd).toBeCloseTo(8.0, 6);
  });

  it("flags an unknown model in totals without breaking the running cost", () => {
    const ledger = new TokenLedger();
    ledger.record(usage({ input_tokens: M }), "claude-haiku-4-5");
    ledger.record(usage({ input_tokens: M }), "mystery-model");
    const t = ledger.totals();
    expect(t.costUsd).toBeCloseTo(1.0, 6); // only the known model counts
    expect(t.unpricedCalls).toBe(1);
  });

  it("reports ok / warn / over against a USD budget", () => {
    const ledger = new TokenLedger({
      budget: { maxUsd: 10, warnAtRatio: 0.8 },
    });
    ledger.record(usage({ output_tokens: M }), "claude-haiku-4-5"); // $5 -> 0.5
    expect(ledger.status()).toBe("ok");
    ledger.record(usage({ output_tokens: 700_000 }), "claude-haiku-4-5"); // +$3.5 -> $8.5, ratio 0.85
    expect(ledger.status()).toBe("warn");
    expect(ledger.ratioUsed()).toBeCloseTo(0.85, 6);
    ledger.record(usage({ output_tokens: 500_000 }), "claude-haiku-4-5"); // +$2.5 -> $11
    expect(ledger.status()).toBe("over");
  });

  it("stays 'ok' with no budget set", () => {
    const ledger = new TokenLedger();
    ledger.record(usage({ output_tokens: 100 * M }), "claude-opus-4-8");
    expect(ledger.status()).toBe("ok");
    expect(ledger.ratioUsed()).toBe(0);
  });
});

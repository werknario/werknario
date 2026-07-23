import { describe, expect, it } from "vitest";
import {
  canonicalModelId,
  checkRunResidency,
  estimateCostUsd,
  getModel,
  isEuSafe,
  validateRoutingPolicy,
  DEFAULT_ROUTING_POLICY,
  type LlmUsage,
} from "../src/index.js";

const M = 1_000_000;
const usage = (u: Partial<LlmUsage>): LlmUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  ...u,
});

describe("multi-model registry (Kimi + others)", () => {
  it("adds Mistral Large 3 as an EU-safe, priced model", () => {
    const m = getModel("mistral-large-3");
    expect(m?.dataResidency).toBe("eu");
    expect(m?.supportsTools).toBe(true);
    expect(isEuSafe("mistral-large-3")).toBe(true);
    const r = estimateCostUsd(usage({ input_tokens: M, output_tokens: M }), "mistral-large-3");
    expect(r.costUsd).toBeCloseTo(2.0, 6); // $0.50 in + $1.50 out
  });

  it("treats the direct Kimi/DeepSeek routes as non-EU (not safe for personal data)", () => {
    expect(getModel("kimi-k2-direct")?.dataResidency).toBe("non-eu");
    expect(isEuSafe("kimi-k2-direct")).toBe(false);
    expect(isEuSafe("deepseek-v4-flash-direct")).toBe(false);
  });

  it("treats a self-hosted Kimi as EU-safe but without a token price", () => {
    expect(isEuSafe("kimi-k2-instruct-selfhost")).toBe(true);
    const r = estimateCostUsd(usage({ input_tokens: M }), "kimi-k2-instruct-selfhost");
    expect(r.priceUnknown).toBe(true); // self-host = compute cost, no per-token price
  });

  it("resolves a raw provider Kimi id to the non-EU direct entry (fail-safe)", () => {
    // A bare provider-returned id must NOT be assumed to be the safe self-host
    // route: it resolves to the priced, non-EU direct entry.
    expect(canonicalModelId("moonshotai/Kimi-K2-Instruct")).toBe("kimi-k2-direct");
    expect(isEuSafe("moonshotai/Kimi-K2-Instruct")).toBe(false);
    // the self-host entry stays reachable by its explicit canonical id
    expect(canonicalModelId("kimi-k2-instruct-selfhost")).toBe(
      "kimi-k2-instruct-selfhost",
    );
  });

  it("blocks a routing policy that sends a tier to a non-EU model", () => {
    const problems = validateRoutingPolicy({
      ...DEFAULT_ROUTING_POLICY,
      euOnly: true,
      modelByTier: {
        simple: "claude-haiku-4-5",
        standard: "claude-sonnet-5",
        high: "kimi-k2-direct", // non-EU
      },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/kimi-k2-direct/);
  });

  it("allows an all-EU multi-vendor policy (Mistral + Claude)", () => {
    const problems = validateRoutingPolicy({
      ...DEFAULT_ROUTING_POLICY,
      euOnly: true,
      modelByTier: {
        simple: "mistral-large-3",
        standard: "claude-sonnet-5",
        high: "claude-opus-4-8",
      },
    });
    expect(problems).toEqual([]);
  });
});

describe("checkRunResidency (the run-path guard)", () => {
  it("exempts the mock provider (nothing leaves the machine)", () => {
    const d = checkRunResidency("mock", "anything", { allowNonEu: false });
    expect(d.ok).toBe(true);
    expect(d.residency).toBe("exempt");
  });

  it("allows bedrock in an EU region", () => {
    const d = checkRunResidency("bedrock", "claude-sonnet-5", {
      region: "eu-central-1",
      allowNonEu: false,
    });
    expect(d.ok).toBe(true);
    expect(d.residency).toBe("eu");
  });

  it("blocks bedrock outside an EU region", () => {
    const d = checkRunResidency("bedrock", "claude-sonnet-5", {
      region: "us-east-1",
      allowNonEu: false,
    });
    expect(d.ok).toBe(false);
    expect(d.residency).toBe("non-eu");
  });

  it("blocks the Anthropic direct (US) route even for an EU-registered model", () => {
    const d = checkRunResidency("anthropic", "claude-sonnet-5", { allowNonEu: false });
    expect(d.ok).toBe(false);
  });

  // Finding F1 (Trust-Audit 2026-07-23): residency for openai-compatible is a
  // property of the endpoint (base_url host), not just the registered model name.
  it("blocks an EU-registered openai-compatible model on a non-EU host (F1)", () => {
    const d = checkRunResidency("openai-compatible", "mistral-large-3", {
      baseUrl: "https://openrouter.ai/api/v1",
      allowNonEu: false,
    });
    expect(d.ok).toBe(false);
    expect(d.residency).toBe("non-eu");
  });

  it("allows an EU openai-compatible model on its known EU host (Mistral)", () => {
    const d = checkRunResidency("openai-compatible", "mistral-large-3", {
      baseUrl: "https://api.mistral.ai/v1",
      allowNonEu: false,
    });
    expect(d.ok).toBe(true);
    expect(d.residency).toBe("eu");
  });

  it("fails safe to non-EU when an EU-registered model has no base_url to verify", () => {
    const d = checkRunResidency("openai-compatible", "mistral-large-3", {
      allowNonEu: false,
    });
    expect(d.ok).toBe(false);
    expect(d.residency).toBe("non-eu");
  });

  it("allows a self-host model only on a local/private endpoint", () => {
    const local = checkRunResidency("openai-compatible", "kimi-k2-instruct-selfhost", {
      baseUrl: "http://localhost:8000/v1",
      allowNonEu: false,
    });
    expect(local.ok).toBe(true);
    expect(local.residency).toBe("self-host");

    const publicHost = checkRunResidency("openai-compatible", "kimi-k2-instruct-selfhost", {
      baseUrl: "https://kimi.example.com/v1",
      allowNonEu: false,
    });
    expect(publicHost.ok).toBe(false);
    expect(publicHost.residency).toBe("non-eu");
  });

  it("honours an operator-declared EU host allowlist (own OVHcloud/vLLM endpoint)", () => {
    const host = "oai.endpoints.kepler.ai.cloud.ovh.net";
    const withAllow = checkRunResidency("openai-compatible", "qwen3-coder-ovhcloud", {
      baseUrl: `https://${host}/v1`,
      euHosts: [host],
      allowNonEu: false,
    });
    expect(withAllow.ok).toBe(true);
    expect(withAllow.residency).toBe("eu");

    const withoutAllow = checkRunResidency("openai-compatible", "qwen3-coder-ovhcloud", {
      baseUrl: `https://${host}/v1`,
      allowNonEu: false,
    });
    expect(withoutAllow.ok).toBe(false);
  });

  it("still allows a non-EU host with the explicit override, marked overridden", () => {
    const d = checkRunResidency("openai-compatible", "mistral-large-3", {
      baseUrl: "https://openrouter.ai/api/v1",
      allowNonEu: true,
    });
    expect(d.ok).toBe(true);
    expect(d.overridden).toBe(true);
    expect(d.residency).toBe("non-eu");
  });

  it("blocks a non-EU openai-compatible model (Kimi direct)", () => {
    expect(
      checkRunResidency("openai-compatible", "kimi-k2-direct", { allowNonEu: false }).ok,
    ).toBe(false);
  });

  it("blocks an unknown model on an openai-compatible endpoint (fail-safe)", () => {
    expect(
      checkRunResidency("openai-compatible", "some-unlisted-model", { allowNonEu: false })
        .ok,
    ).toBe(false);
  });

  it("proceeds on a non-EU route with the override, but marks it overridden", () => {
    const d = checkRunResidency("anthropic", "claude-sonnet-5", { allowNonEu: true });
    expect(d.ok).toBe(true);
    expect(d.overridden).toBe(true);
  });
});

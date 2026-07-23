import { describe, expect, it } from "vitest";
import {
  approversFor,
  canWrite,
  checkApprover,
  matchGlob,
  parsePolicy,
  type WerknarioPolicy,
} from "../src/index.js";

describe("checkApprover", () => {
  const policy: WerknarioPolicy = {
    approvers: {
      "vertraege/**": ["anna", "chef"],
      "**": ["anna"],
    },
  };

  it("authorizes a human on the most-specific rule", () => {
    const r = checkApprover(policy, "human:chef", ["vertraege/split.md"]);
    expect(r.authorized).toBe(true);
    expect(r.unmetPaths).toEqual([]);
  });

  it("refuses a human not on the rule for a touched path", () => {
    const r = checkApprover(policy, "human:bob", ["vertraege/split.md"]);
    expect(r.authorized).toBe(false);
    expect(r.unmetPaths).toEqual(["vertraege/split.md"]);
    expect(r.requiredApprovers).toEqual(["anna", "chef"]);
  });

  it("takes the bare-name or prefixed form", () => {
    expect(checkApprover(policy, "anna", ["inbox/x.md"]).authorized).toBe(true);
  });

  it("does not gate a path with no approver rule", () => {
    const bare: WerknarioPolicy = { approvers: { "vertraege/**": ["anna"] } };
    expect(checkApprover(bare, "bob", ["drafts/x.md"]).authorized).toBe(true);
  });

  it("reports every unmet path when several are touched", () => {
    const r = checkApprover(policy, "human:chef", [
      "vertraege/a.md",
      "vertraege/b.md",
    ]);
    // chef is on vertraege/**, so both are fine
    expect(r.authorized).toBe(true);
    const r2 = checkApprover(policy, "human:bob", ["vertraege/a.md", "x.md"]);
    expect(r2.unmetPaths.sort()).toEqual(["vertraege/a.md", "x.md"]);
  });
});

describe("matchGlob", () => {
  it("matches ** across slashes and * within a segment", () => {
    expect(matchGlob("personal/**", "personal/anna/onboarding.md")).toBe(true);
    expect(matchGlob("personal/*", "personal/anna.md")).toBe(true);
    expect(matchGlob("personal/*", "personal/anna/deep.md")).toBe(false);
    expect(matchGlob("**", "anything/at/all.md")).toBe(true);
    expect(matchGlob("vertraege/**", "personal/x.md")).toBe(false);
  });

  it("treats a bare name as an exact match", () => {
    expect(matchGlob("README.md", "README.md")).toBe(true);
    expect(matchGlob("README.md", "docs/README.md")).toBe(false);
  });
});

const policy: WerknarioPolicy = {
  agents: {
    "hr-bot": { allow: ["personal/**", "onboarding/**"], deny: ["personal/gehalt/**"] },
    "audit-bot": { deny: ["**"] },
  },
  approvers: {
    "vertraege/**": ["anna", "chef"],
    "**": ["anna"],
  },
};

describe("canWrite", () => {
  it("allows a path inside the agent's allow list", () => {
    expect(canWrite(policy, "hr-bot", "personal/anna/onboarding.md").allowed).toBe(true);
  });

  it("denies a path outside the allow list", () => {
    const r = canWrite(policy, "hr-bot", "vertraege/x.md");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("lets deny win over allow", () => {
    expect(canWrite(policy, "hr-bot", "personal/gehalt/anna.md").allowed).toBe(false);
  });

  it("denies everything for an agent with deny **", () => {
    expect(canWrite(policy, "audit-bot", "personal/x.md").allowed).toBe(false);
  });

  it("normalizes repeated slashes so a deny rule can't be slipped with //", () => {
    // Without normalization "personal/gehalt//anna.md" would dodge the
    // "personal/gehalt/**" deny; with it, the write is correctly blocked.
    expect(canWrite(policy, "hr-bot", "personal/gehalt//anna.md").allowed).toBe(false);
    expect(canWrite(policy, "hr-bot", "personal/anna.md").allowed).toBe(true);
  });

  it("is permissive when no policy or no agent entry exists", () => {
    expect(canWrite(policy, "unknown-bot", "anything.md").allowed).toBe(true);
    expect(canWrite({}, "hr-bot", "anything.md").allowed).toBe(true);
  });
});

describe("approversFor", () => {
  it("returns the most specific matching approver list", () => {
    expect(approversFor(policy, "vertraege/split.md")).toEqual(["anna", "chef"]);
  });

  it("falls back to the catch-all", () => {
    expect(approversFor(policy, "personal/x.md")).toEqual(["anna"]);
  });

  it("returns empty when nothing matches", () => {
    expect(approversFor({ approvers: { "vertraege/**": ["chef"] } }, "personal/x.md")).toEqual([]);
  });
});

describe("parsePolicy", () => {
  it("accepts a valid policy and rejects junk shapes", () => {
    expect(parsePolicy(policy)).toEqual(policy);
    expect(parsePolicy({})).toEqual({});
    expect(() => parsePolicy({ agents: "nope" })).toThrow();
    expect(() => parsePolicy(null)).toThrow();
    expect(() => parsePolicy({ agents: { x: { allow: "nope" } } })).toThrow();
  });
});

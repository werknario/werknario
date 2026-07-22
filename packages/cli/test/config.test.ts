import { describe, expect, it } from "vitest";
import { loadCliConfig } from "../src/config.js";

const MOCK = { WERKNARIO_BACKEND: "mock" } as NodeJS.ProcessEnv;

describe("loadCliConfig", () => {
  it("joins positional args into the task and skips value-taking flags", () => {
    const { task, config } = loadCliConfig(MOCK, [
      "Draft",
      "the",
      "split",
      "sheet",
      "--yes",
      "--verify-cmd",
      "npm test",
      "--budget",
      "5",
    ]);
    expect(task).toBe("Draft the split sheet");
    expect(config.autoApprove).toBe(true);
    expect(config.verifyCmd).toBe("npm test");
    expect(config.budgetUsd).toBe(5);
  });

  it("adds the agent:/human: prefix when omitted and lets a flag win over env", () => {
    const { config } = loadCliConfig(
      { ...MOCK, WERKNARIO_AGENT_ID: "agent:env" },
      ["do it", "--agent", "hr-bot", "--human", "anna"],
    );
    expect(config.agentId).toBe("agent:hr-bot");
    expect(config.humanId).toBe("human:anna");
  });

  it("keeps an existing prefix as-is", () => {
    const { config } = loadCliConfig(MOCK, ["x", "--agent", "agent:already"]);
    expect(config.agentId).toBe("agent:already");
  });

  it("picks the backend: explicit, GitHub-when-repo-set, else GitLab", () => {
    expect(loadCliConfig(MOCK, ["x"]).config.backend).toBe("mock");
    expect(
      loadCliConfig({ GITHUB_REPO: "o/r", GITHUB_TOKEN: "t" }, ["x"]).config.backend,
    ).toBe("github");
    expect(
      loadCliConfig({ GITLAB_PROJECT_ID: "1", GITLAB_TOKEN: "t" }, ["x"]).config
        .backend,
    ).toBe("gitlab");
  });

  it("reads --dry-run and defaults locale to en", () => {
    const { config } = loadCliConfig(MOCK, ["x", "--dry-run"]);
    expect(config.dryRun).toBe(true);
    expect(config.locale).toBe("en");
    expect(loadCliConfig(MOCK, ["x", "--de"]).config.locale).toBe("de");
  });

  it("throws with a helpful message when a real backend lacks its credentials", () => {
    expect(() => loadCliConfig({ WERKNARIO_BACKEND: "gitlab" }, ["x"])).toThrow(
      /GITLAB_TOKEN|GITLAB_PROJECT_ID/,
    );
    expect(() => loadCliConfig({ WERKNARIO_BACKEND: "github" }, ["x"])).toThrow(
      /GITHUB_TOKEN|GITHUB_REPO/,
    );
  });
});

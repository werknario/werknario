import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  isApprovalRequired,
  TOOL,
  TOOL_DEFINITIONS,
} from "../src/index.js";

describe("tool definitions", () => {
  it("has a definition for every tool name, with unique names", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names)).toEqual(new Set(Object.values(TOOL)));
  });

  it("declares every required field as an actual property", () => {
    for (const def of TOOL_DEFINITIONS) {
      const props = Object.keys(def.input_schema.properties);
      for (const req of def.input_schema.required ?? []) {
        expect(props).toContain(req);
      }
    }
  });
});

describe("isApprovalRequired", () => {
  it("gates the team-visible writes", () => {
    expect(isApprovalRequired(TOOL.CREATE_MERGE_REQUEST)).toBe(true);
    expect(isApprovalRequired(TOOL.ADD_COMMENT)).toBe(true);
  });
  it("leaves reads and the local diff preview ungated", () => {
    expect(isApprovalRequired(TOOL.LIST_FILES)).toBe(false);
    expect(isApprovalRequired(TOOL.READ_FILE)).toBe(false);
    expect(isApprovalRequired(TOOL.PROPOSE_EDIT)).toBe(false);
  });
});

describe("buildSystemPrompt", () => {
  it("includes the project and the propose-not-execute principle", () => {
    const p = buildSystemPrompt({ projectPath: "x-concapps/fleetlicht-demo", defaultBranch: "main" });
    expect(p).toContain("x-concapps/fleetlicht-demo");
    expect(p).toContain("main");
    expect(p).toContain("Du schlägst vor");
    // no unresolved template artifacts
    expect(p).not.toContain("${");
  });
});

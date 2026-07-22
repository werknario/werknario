/**
 * A small evaluation harness: run the agent against seeded fixtures and check the
 * outcome. Offline it uses the mock provider (deterministic, no keys), so it
 * doubles as an end-to-end regression check; point it at a real provider and it
 * becomes a "does it work with my model and setup" smoke test.
 *
 * Adding scenarios that exercise different behaviour needs a real model (the mock
 * provider only knows the one scripted flow). That is called out honestly here.
 */

import { createHash } from "node:crypto";
import {
  AuditLog,
  buildSystemPrompt,
  type LlmCaller,
  type ToolBackend,
} from "@werknario/shared";
import { runTask, type RunTaskResult } from "./runTask.js";
import { mockBackend } from "./mockBackend.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface EvalContext {
  result: RunTaskResult;
  backend: ToolBackend;
  audit: AuditLog;
}

export interface EvalCheck {
  name: string;
  /** Return true if the check passes, or an explanation string if it fails. */
  run(ctx: EvalContext): Promise<true | string>;
}

export interface Scenario {
  name: string;
  /** Files the in-memory repo starts with. Defaults to the mock's seed. */
  seed?: Record<string, string>;
  task: string;
  checks: EvalCheck[];
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  costUsd: number;
}

export async function runScenario(
  scenario: Scenario,
  caller: LlmCaller,
): Promise<ScenarioResult> {
  const { backend } = mockBackend(scenario.seed);
  const audit = new AuditLog({
    hash: sha256,
    now: () => new Date().toISOString(),
    genesisHash: "eval/mock",
  });

  const result = await runTask(scenario.task, {
    backend,
    caller,
    system: buildSystemPrompt({
      projectPath: "eval/mock",
      defaultBranch: "main",
      locale: "en",
    }),
    approve: async () => true,
    out: () => {},
    audit,
    agentId: "agent:eval",
    humanId: "human:eval",
    maxTurns: 8,
  });

  const ctx: EvalContext = { result, backend, audit };
  const checks: ScenarioResult["checks"] = [];
  for (const check of scenario.checks) {
    try {
      const r = await check.run(ctx);
      checks.push(
        r === true ? { name: check.name, ok: true } : { name: check.name, ok: false, detail: r },
      );
    } catch (e) {
      checks.push({
        name: check.name,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    name: scenario.name,
    passed: checks.every((c) => c.ok),
    checks,
    costUsd: result.usage.costUsd,
  };
}

const SPLIT_SHEET_PATH =
  "mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md";

export const SCENARIOS: Scenario[] = [
  {
    name: "session note -> split sheet -> merge request",
    task: "Draft the split sheet from the session note",
    checks: [
      {
        name: "opens a merge request",
        run: async ({ result }) =>
          result.mr ? true : "no merge request was opened",
      },
      {
        name: "proposes the split sheet file",
        run: async ({ backend }) => {
          try {
            const c = await backend.readFile(SPLIT_SHEET_PATH);
            return c.includes("Split Sheet")
              ? true
              : "the split sheet file has unexpected content";
          } catch {
            return "the split sheet file was not created";
          }
        },
      },
      {
        name: "audit chain verifies",
        run: async ({ audit }) =>
          audit.verify().ok ? true : "the audit chain does not verify",
      },
      {
        name: "records propose_edit and create_merge_request",
        run: async ({ audit }) => {
          const actions = audit.entries().map((e) => e.action);
          return actions.includes("propose_edit") &&
            actions.includes("create_merge_request")
            ? true
            : `missing expected actions; got ${actions.join(", ")}`;
        },
      },
    ],
  },
];

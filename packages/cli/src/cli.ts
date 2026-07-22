/**
 * werknario CLI. Give it a task in plain language; it reads your repo (GitLab or
 * GitHub), proposes changes, asks you to approve, opens a merge/pull request, and
 * can merge it — recording every step to a tamper-evident audit log. It calls the
 * model directly (no separate server needed), reusing the same providers the
 * extension uses.
 */

import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import {
  buildSystemPrompt,
  canWrite,
  DEFAULT_ROUTING_POLICY,
  diffLines,
  formatDiff,
  parsePolicy,
  type ToolBackend,
} from "@werknario/shared";
import { GitlabClient, GitLabRestBackend } from "@werknario/gitlab-client";
import { GitHubClient, GitHubRestBackend } from "@werknario/github-client";
import { createProvider, loadConfig } from "@werknario/proxy";
import { loadCliConfig, opt, type CliConfig } from "./config.js";
import { verifyAuditText } from "./verifyCommand.js";
import { runTask, type ApprovalRequest, type RunEvent } from "./runTask.js";
import { closeLoop } from "./closeLoop.js";
import { gitlabGateway, githubGateway } from "./gateways.js";
import { mockBackend } from "./mockBackend.js";
import { openAuditLog } from "./auditStore.js";
import type { MergeGateway } from "./closeLoop.js";

const USAGE = `werknario — an agent that proposes document changes as reviewable, auditable diffs.

Usage:
  werknario "your task in plain language" [options]
  werknario verify [audit.jsonl] [--genesis <owner/repo>]   check an audit log

Options:
  --yes          approve everything automatically (unattended)
  --route        let the agent pick a cheaper model for simple steps
  --budget <usd> stop when the run's cost reaches this many USD
  --de           German prompts and messages
  --audit <path> audit log file (default .werknario/audit.jsonl)
  --policy <path> permission file (default .werknario/policy.json)
  --max-turns <n> cap the number of model turns

Backend (GitLab or GitHub) and model come from the environment. See the README.
`;

function isYes(a: string): boolean {
  const s = a.trim().toLowerCase();
  return s === "y" || s === "yes" || s === "j" || s === "ja";
}

function describeApproval(r: ApprovalRequest): string {
  const inp = r.input;
  if (r.tool === "create_merge_request") {
    return [
      "The agent wants to open a merge/pull request:",
      `  title:  ${String(inp["title"] ?? "")}`,
      `  branch: ${String(inp["source_branch"] ?? "")}`,
      `  body:   ${String(inp["description"] ?? "").slice(0, 400)}`,
    ].join("\n");
  }
  if (r.tool === "add_comment") {
    return `The agent wants to comment on ${String(inp["target_type"])} #${String(inp["iid"])}:\n  ${String(inp["body"] ?? "").slice(0, 400)}`;
  }
  return `The agent wants to run ${r.tool}.`;
}

function printEvent(e: RunEvent): void {
  if (e.type === "assistant") process.stdout.write(`\n${e.text}\n`);
  else if (e.type === "tool") process.stdout.write(`  · ${e.name}\n`);
  else if (e.type === "info") process.stdout.write(`  ${e.text}\n`);
  else if (e.type === "proposal") {
    const kind = e.isNew ? "new file" : "change";
    const diff = formatDiff(diffLines(e.previous, e.content), { context: 3 });
    const indented = diff
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
    process.stdout.write(`\n  proposal (${kind}): ${e.path}\n${indented}\n`);
  }
}

async function buildBackend(config: CliConfig): Promise<{
  backend: ToolBackend;
  gateway: MergeGateway;
  projectPath: string;
  defaultBranch: string;
}> {
  if (config.backend === "mock") {
    const { backend, gateway } = mockBackend();
    return { backend, gateway, projectPath: "mock/demo", defaultBranch: "main" };
  }
  if (config.backend === "gitlab" && config.gitlab) {
    const client = new GitlabClient({
      baseUrl: config.gitlab.baseUrl,
      token: config.gitlab.token,
      projectId: config.gitlab.projectId,
    });
    const backend = new GitLabRestBackend(client);
    await backend.init();
    const project = await client.getProject();
    return {
      backend,
      gateway: gitlabGateway(client),
      projectPath: project.path_with_namespace,
      defaultBranch: project.default_branch,
    };
  }
  if (config.backend === "github" && config.github) {
    const client = new GitHubClient({
      repo: config.github.repo,
      token: config.github.token,
      ...(config.github.baseUrl ? { baseUrl: config.github.baseUrl } : {}),
    });
    const backend = new GitHubRestBackend(client);
    await backend.init();
    const repo = await client.getRepo();
    return {
      backend,
      gateway: githubGateway(client),
      projectPath: repo.full_name,
      defaultBranch: repo.default_branch,
    };
  }
  throw new Error("No backend configured.");
}

/** `werknario verify [path] [--genesis <repo>]` — check an audit log and exit. */
function runVerify(argv: string[]): void {
  const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  const path = positional ?? opt(argv, "audit") ?? ".werknario/audit.jsonl";
  if (!existsSync(path)) {
    process.stderr.write(`No audit file at ${path}\n`);
    process.exit(1);
  }
  const outcome = verifyAuditText(readFileSync(path, "utf8"), opt(argv, "genesis"));
  const head = outcome.ok
    ? `verified (${outcome.entries} entries, genesis ${outcome.genesisUsed})`
    : `BROKEN at entry ${outcome.brokenAt ?? "?"}: ${outcome.reason ?? "unknown"}`;
  process.stdout.write(`Audit ${path} — chain ${head}.\n`);
  process.exit(outcome.ok ? 0 : 1);
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  if (rawArgv[0] === "verify") {
    runVerify(rawArgv);
    return;
  }
  const { task, config } = loadCliConfig(process.env, rawArgv);
  if (!task) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const { backend, gateway, projectPath, defaultBranch } = await buildBackend(config);

  const proxyConfig = loadConfig(process.env);
  const provider = createProvider(proxyConfig);
  const bedrockEu = proxyConfig.provider === "bedrock";

  const system = buildSystemPrompt({
    projectPath,
    defaultBranch,
    userName: config.humanId,
    locale: config.locale,
  });
  const audit = openAuditLog(config.auditPath, projectPath);

  let writeGuard: ((path: string) => { allowed: boolean; reason?: string }) | undefined;
  if (existsSync(config.policyPath)) {
    const policy = parsePolicy(JSON.parse(readFileSync(config.policyPath, "utf8")));
    const bareAgent = config.agentId.replace(/^agent:/, "");
    writeGuard = (path: string) => canWrite(policy, bareAgent, path);
  } else {
    process.stdout.write(
      `Note: no policy file at ${config.policyPath} — ${config.agentId} may write any path. See docs/permissions.md.\n`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => rl.question(q);
  const approve = async (r: ApprovalRequest): Promise<boolean> => {
    if (config.autoApprove) return true;
    process.stdout.write(`\n${describeApproval(r)}\n`);
    return isYes(await ask("Approve? [y/N] "));
  };

  process.stdout.write(`\nwerknario · ${projectPath} (${config.backend})\nTask: ${task}\n`);

  try {
    const result = await runTask(task, {
      backend,
      caller: (req) => provider.createMessage(req),
      system,
      approve,
      out: printEvent,
      audit,
      agentId: config.agentId,
      humanId: config.humanId,
      bedrockEu,
      ...(config.routing ? { routing: DEFAULT_ROUTING_POLICY } : {}),
      ...(config.budgetUsd ? { budget: { maxUsd: config.budgetUsd, warnAtRatio: 0.8 } } : {}),
      ...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
      ...(writeGuard ? { writeGuard } : {}),
    });

    const u = result.usage;
    process.stdout.write(
      `\n— ${u.calls} model call(s), ${(u.inputTokens + u.outputTokens).toLocaleString("en-US")} tokens` +
        (u.costUsd > 0 ? `, ~$${u.costUsd.toFixed(4)}` : "") +
        (result.stopped === "budget" ? " (stopped at budget)" : "") +
        "\n",
    );

    if (result.mr) {
      process.stdout.write(`\nMerge request opened: ${result.mr.webUrl}\n`);
      await closeLoop(result.mr.iid, {
        gateway,
        approveMerge: async (iid) =>
          config.autoApprove ? true : isYes(await ask(`Merge !${iid} now? [y/N] `)),
        out: (l) => process.stdout.write(`  ${l}\n`),
        audit,
        humanId: config.humanId,
        agentId: config.agentId,
        locale: config.locale,
      });
    }
  } finally {
    // Entries were written to disk as they were made (openAuditLog's onAppend),
    // so there is nothing to flush here — just report the chain state and head.
    const v = audit.verify();
    process.stdout.write(
      `\nAudit: ${audit.entries().length} entries at ${config.auditPath} — chain ${v.ok ? "verified" : "BROKEN"} (head ${audit.lastHash.slice(0, 12)}).\n`,
    );
    rl.close();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nError: ${msg}\n`);
  process.exit(1);
});

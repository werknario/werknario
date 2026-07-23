/**
 * werknario CLI. Give it a task in plain language; it reads your repo (GitLab or
 * GitHub), proposes changes, asks you to approve, opens a merge/pull request, and
 * can merge it — recording every step to a tamper-evident audit log. It calls the
 * model directly (no separate server needed), reusing the same providers the
 * extension uses.
 */

import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildSystemPrompt,
  canWrite,
  checkRunResidency,
  DEFAULT_ROUTING_POLICY,
  diffLines,
  formatDiff,
  friendlyError,
  parsePolicy,
  signatureDetail,
  validateRoutingPolicy,
  verifySignatures,
  type ToolBackend,
  type WerknarioPolicy,
} from "@werknario/shared";
import { GitlabClient, GitLabRestBackend } from "@werknario/gitlab-client";
import { GitHubClient, GitHubRestBackend } from "@werknario/github-client";
import { createProvider, loadConfig } from "@werknario/proxy";
import { loadCliConfig, opt, type CliConfig } from "./config.js";
import { verifyAuditText } from "./verifyCommand.js";
import { verifyWithCommand } from "./shellVerify.js";
import { runScenario, SCENARIOS } from "./eval.js";
import { runTask, type ApprovalRequest, type RunEvent } from "./runTask.js";
import { closeLoop } from "./closeLoop.js";
import { gitlabGateway, githubGateway } from "./gateways.js";
import { mockBackend } from "./mockBackend.js";
import { openAuditLog } from "./auditStore.js";
import {
  generateKeypair,
  keyIdFromPrivatePem,
  makeVerifier,
  signData,
} from "./signing.js";
import type { MergeGateway } from "./closeLoop.js";

const USAGE = `werknario — an agent that proposes document changes as reviewable, auditable diffs.

Usage:
  werknario "your task in plain language" [options]
  werknario verify [audit.jsonl] [--genesis <owner/repo>] [--pubkey <key.pub>]
  werknario keygen [--out <prefix>]                          make an Ed25519 signing key

Options:
  --yes          approve everything automatically (unattended)
  --dry-run      show what the agent would do, but open nothing
  --route        let the agent pick a cheaper model for simple steps
  --budget <usd> stop when the run's cost reaches this many USD
  --verify-cmd <cmd>  run a shell command before merging; non-zero blocks it
  --de           German prompts and messages
  --audit <path> audit log file (default .werknario/audit.jsonl)
  --policy <path> permission file (default .werknario/policy.json)
  --max-turns <n> cap the number of model turns

Signing (optional, self-hosted, EU-resident): set WERKNARIO_SIGNING_KEY to an
Ed25519 private key (from 'werknario keygen') and each run signs the chain head;
'werknario verify --pubkey <key.pub>' checks those signatures.

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
    if (!e.diffAvailable) {
      process.stdout.write(
        `\n  proposal (${kind}): ${e.path}\n    (diff unavailable — the current file could not be read; review the change carefully before approving)\n`,
      );
      return;
    }
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
  /** The username the backend token authenticates as, when it can be read. */
  authenticatedHuman?: string;
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
    const authenticatedHuman = await client
      .getAuthenticatedUser()
      .catch(() => undefined);
    return {
      backend,
      gateway: gitlabGateway(client),
      projectPath: project.path_with_namespace,
      defaultBranch: project.default_branch,
      ...(authenticatedHuman ? { authenticatedHuman } : {}),
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
    const authenticatedHuman = await client
      .getAuthenticatedUser()
      .catch(() => undefined);
    return {
      backend,
      gateway: githubGateway(client),
      projectPath: repo.full_name,
      defaultBranch: repo.default_branch,
      ...(authenticatedHuman ? { authenticatedHuman } : {}),
    };
  }
  throw new Error("No backend configured.");
}

/** `werknario verify [path] [--genesis <repo>] [--pubkey <key.pub>]`. */
function runVerify(argv: string[]): void {
  const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  const path = positional ?? opt(argv, "audit") ?? ".werknario/audit.jsonl";
  if (!existsSync(path)) {
    process.stderr.write(`No audit file at ${path}\n`);
    process.exit(1);
  }
  const text = readFileSync(path, "utf8");
  const outcome = verifyAuditText(text, opt(argv, "genesis"));
  const head = outcome.ok
    ? `verified (${outcome.entries} entries, genesis ${outcome.genesisUsed})`
    : `BROKEN at entry ${outcome.brokenAt ?? "?"}: ${outcome.reason ?? "unknown"}`;
  process.stdout.write(`Audit ${path} — chain ${head}.\n`);
  if (!outcome.ok) process.exit(1);

  // Optional: check the Ed25519 signature checkpoints against a public key.
  const pubkeyPath = opt(argv, "pubkey");
  if (pubkeyPath) {
    if (!existsSync(pubkeyPath)) {
      process.stderr.write(`No public key at ${pubkeyPath}\n`);
      process.exit(1);
    }
    const entries = text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map(
        (l) =>
          JSON.parse(l) as {
            seq: number;
            action: string;
            detail?: unknown;
            hash: string;
          },
      );
    const sig = verifySignatures(entries, makeVerifier(readFileSync(pubkeyPath, "utf8")));
    if (!sig.ok) {
      process.stdout.write(`Signatures — FAILED: ${sig.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(
      sig.checked > 0
        ? `Signatures — ${sig.checked} verified for the given key.\n`
        : `Signatures — none in this log (nothing was signed).\n`,
    );
  }
  process.exit(0);
}

/** `werknario keygen [--out <prefix>]` — write an Ed25519 signing keypair. */
function runKeygen(argv: string[]): void {
  const prefix = opt(argv, "out") ?? "werknario-signing";
  const privPath = `${prefix}.key`;
  const pubPath = `${prefix}.pub`;
  if (existsSync(privPath) || existsSync(pubPath)) {
    process.stderr.write(
      `Refusing to overwrite an existing ${privPath} or ${pubPath}. Pick another --out prefix.\n`,
    );
    process.exit(1);
  }
  const { privatePem, publicPem, keyId } = generateKeypair();
  writeFileSync(privPath, privatePem, { mode: 0o600 });
  writeFileSync(pubPath, publicPem);
  process.stdout.write(
    `Wrote ${privPath} (private — keep it secret) and ${pubPath} (public — share it).\n` +
      `Key id ${keyId}.\n\n` +
      `Sign each run:  export WERKNARIO_SIGNING_KEY=${privPath}\n` +
      `Verify a log:   werknario verify --pubkey ${pubPath}\n`,
  );
  process.exit(0);
}

/** `werknario eval` — run the built-in scenarios against the configured model. */
async function runEval(): Promise<void> {
  const provider = createProvider(loadConfig(process.env));
  const caller = (req: Parameters<typeof provider.createMessage>[0]) =>
    provider.createMessage(req);
  process.stdout.write(`\nwerknario eval — ${SCENARIOS.length} scenario(s)\n`);
  let allPassed = true;
  for (const scenario of SCENARIOS) {
    const r = await runScenario(scenario, caller);
    if (!r.passed) allPassed = false;
    process.stdout.write(
      `\n${r.passed ? "PASS" : "FAIL"}  ${r.name}` +
        (r.costUsd > 0 ? `  (~$${r.costUsd.toFixed(4)})` : "") +
        "\n",
    );
    for (const c of r.checks) {
      process.stdout.write(
        `  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}\n`,
      );
    }
  }
  process.stdout.write(
    `\n${allPassed ? "All scenarios passed." : "Some scenarios failed."}\n`,
  );
  process.exit(allPassed ? 0 : 1);
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  if (rawArgv[0] === "verify") {
    runVerify(rawArgv);
    return;
  }
  if (rawArgv[0] === "keygen") {
    runKeygen(rawArgv);
    return;
  }
  if (rawArgv[0] === "eval") {
    await runEval();
    return;
  }
  const { task, config } = loadCliConfig(process.env, rawArgv);
  if (!task) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  // Fail fast on data residency before touching any backend or model. The mock
  // provider is exempt; a non-EU route is blocked unless the override is set.
  const proxyConfig = loadConfig(process.env);
  const allowNonEu = /^(1|true|yes)$/i.test(process.env.WERKNARIO_ALLOW_NON_EU ?? "");
  const residency = checkRunResidency(proxyConfig.provider, proxyConfig.model, {
    region: proxyConfig.bedrock.region,
    baseUrl: proxyConfig.openaiCompatible.baseUrl,
    euHosts: proxyConfig.openaiCompatible.euHosts,
    allowNonEu,
  });
  if (!residency.ok) {
    process.stderr.write(`\nBlocked: ${residency.reason}\n`);
    process.exit(1);
  }
  if (residency.overridden) {
    process.stdout.write(`\nWARNING: ${residency.reason}\n`);
  }
  if (config.routing) {
    const problems = validateRoutingPolicy(DEFAULT_ROUTING_POLICY);
    if (problems.length > 0 && !allowNonEu) {
      process.stderr.write(
        "\nBlocked: the routing policy includes a non-EU model:\n" +
          problems.map((p) => `  - ${p}`).join("\n") +
          "\nSet WERKNARIO_ALLOW_NON_EU=1 to override.\n",
      );
      process.exit(1);
    }
  }

  const { backend, gateway, projectPath, defaultBranch, authenticatedHuman } =
    await buildBackend(config);

  // For a real backend the approver identity comes from the token, not a
  // self-declared --human. That authentication is what makes the approver gate
  // below a control rather than an honour system. The mock keeps its demo name.
  const humanId = authenticatedHuman
    ? `human:${authenticatedHuman}`
    : config.humanId;
  if (
    authenticatedHuman &&
    config.humanId !== "human:you" &&
    config.humanId !== humanId
  ) {
    process.stdout.write(
      `Note: approving as the authenticated identity ${humanId}, not the --human value ${config.humanId}.\n`,
    );
  }

  const provider = createProvider(proxyConfig);
  const bedrockEu = proxyConfig.provider === "bedrock";

  const system = buildSystemPrompt({
    projectPath,
    defaultBranch,
    userName: humanId,
    locale: config.locale,
  });
  const audit = openAuditLog(config.auditPath, projectPath);

  // Anchor the residency decision in the tamper-evident chain, so an EU run and
  // an overridden (non-EU) run are both recorded, not just printed to stdout.
  audit.append("system", "residency", {
    provider: proxyConfig.provider,
    region: proxyConfig.bedrock.region ?? null,
    residency: residency.residency,
    overridden: residency.overridden,
  });

  let writeGuard: ((path: string) => { allowed: boolean; reason?: string }) | undefined;
  let policy: WerknarioPolicy | undefined;
  if (existsSync(config.policyPath)) {
    policy = parsePolicy(JSON.parse(readFileSync(config.policyPath, "utf8")));
    const loaded = policy;
    const bareAgent = config.agentId.replace(/^agent:/, "");
    writeGuard = (path: string) => canWrite(loaded, bareAgent, path);
  } else {
    process.stdout.write(
      `Note: no policy file at ${config.policyPath} — ${config.agentId} may write any path. See docs/permissions.md.\n`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => rl.question(q);
  const approve = async (r: ApprovalRequest): Promise<boolean> => {
    if (config.dryRun) {
      process.stdout.write(`\n[dry run] would ${r.tool} — declining.\n`);
      return false;
    }
    if (config.autoApprove) return true;
    process.stdout.write(`\n${describeApproval(r)}\n`);
    return isYes(await ask("Approve? [y/N] "));
  };

  process.stdout.write(`\nwerknario · ${projectPath} (${config.backend})\nTask: ${task}\n`);

  // Collect the paths the agent proposes, so the merge gate can check them
  // against the policy's approver rules.
  const touchedPaths = new Set<string>();
  const out = (e: RunEvent): void => {
    if (e.type === "proposal") touchedPaths.add(e.path);
    printEvent(e);
  };

  try {
    const result = await runTask(task, {
      backend,
      caller: (req) => provider.createMessage(req),
      system,
      approve,
      out,
      audit,
      agentId: config.agentId,
      humanId,
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
        (result.stopped === "budget"
          ? " (stopped at budget)"
          : result.stopped === "max_turns"
            ? " (stopped at the turn limit)"
            : result.stopped === "no_progress"
              ? " (stopped: the agent kept hitting the same error — check the last message)"
              : "") +
        "\n",
    );

    if (result.mr) {
      process.stdout.write(`\nMerge request opened: ${result.mr.webUrl}\n`);
      await closeLoop(result.mr.iid, {
        gateway,
        approveMerge: async (iid) =>
          config.autoApprove ? true : isYes(await ask(`Merge !${iid} now? [y/N] `)),
        ...(config.verifyCmd
          ? { verify: () => verifyWithCommand(config.verifyCmd as string) }
          : {}),
        out: (l) => process.stdout.write(`  ${l}\n`),
        audit,
        humanId,
        agentId: config.agentId,
        locale: config.locale,
        ...(policy ? { policy } : {}),
        touchedPaths: [...touchedPaths],
      });
    } else if (config.dryRun) {
      // No merge request was opened. Say so plainly, so the agent's own
      // narration (which may optimistically claim it opened one) cannot mislead.
      process.stdout.write(
        "\nDry run: nothing was opened or merged. Re-run without --dry-run to act.\n",
      );
    }
  } finally {
    // Optional: sign the chain head with the operator's Ed25519 key, appending a
    // signature checkpoint. Verified later with `verify --pubkey`. Self-hosted;
    // nothing leaves the machine.
    if (process.env.WERKNARIO_SIGNING_KEY) {
      try {
        const privatePem = readFileSync(process.env.WERKNARIO_SIGNING_KEY, "utf8");
        const signedHead = audit.lastHash;
        const keyId = keyIdFromPrivatePem(privatePem);
        audit.append(
          "system",
          "signature",
          signatureDetail(signedHead, signData(signedHead, privatePem), keyId),
        );
        process.stdout.write(
          `\nSigned chain head ${signedHead.slice(0, 12)} with key ${keyId}.\n`,
        );
      } catch (e) {
        process.stderr.write(
          `\nCould not sign the audit log: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }

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
  const raw = err instanceof Error ? err.message : String(err);
  const locale =
    process.env.WERKNARIO_LOCALE === "de" || process.argv.includes("--de")
      ? "de"
      : "en";
  const fe = friendlyError(
    { message: raw, name: err instanceof Error ? err.name : undefined },
    locale,
  );
  process.stderr.write(`\n${fe.message}\n${fe.hint}\n`);
  if (fe.code === "network" && process.env.LLM_OPENAI_COMPAT_BASE_URL) {
    process.stderr.write(`Endpoint: ${process.env.LLM_OPENAI_COMPAT_BASE_URL}\n`);
  }
  process.stderr.write(`(details: ${raw})\n`);
  process.exit(1);
});


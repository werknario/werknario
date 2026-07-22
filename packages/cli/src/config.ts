/**
 * CLI configuration from environment + argv. No dependency, small on purpose.
 * Secrets (tokens, API keys) come from the environment, never from argv, so they
 * do not land in shell history.
 */

export type BackendKind = "gitlab" | "github" | "mock";

export interface CliConfig {
  backend: BackendKind;
  gitlab?: { baseUrl: string; projectId: string; token: string };
  github?: { repo: string; token: string; baseUrl?: string };
  agentId: string;
  humanId: string;
  autoApprove: boolean;
  routing: boolean;
  budgetUsd?: number;
  locale: "en" | "de";
  auditPath: string;
  policyPath: string;
  maxTurns?: number;
  /** Show what the agent would do, but decline every team-visible write. */
  dryRun: boolean;
  /** Shell command run as an external check before a merge; non-zero blocks it. */
  verifyCmd?: string;
}

export interface ParsedInvocation {
  task: string;
  config: CliConfig;
}

function flag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

export function opt(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

/** Positional args (everything that is not a flag or a flag's value) joined as the task. */
function positional(argv: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      // skip the value of value-taking flags
      if (
        ["budget", "audit", "policy", "agent", "human", "max-turns", "verify-cmd"].includes(
          a.slice(2),
        )
      ) {
        i += 1;
      }
      continue;
    }
    out.push(a);
  }
  return out.join(" ").trim();
}

export function loadCliConfig(
  env: NodeJS.ProcessEnv,
  argv: string[],
): ParsedInvocation {
  const task = positional(argv);

  const backendEnv = env.WERKNARIO_BACKEND;
  const backend: BackendKind =
    backendEnv === "github" || backendEnv === "gitlab" || backendEnv === "mock"
      ? backendEnv
      : env.GITHUB_REPO
        ? "github"
        : "gitlab";

  const agentFlag = opt(argv, "agent");
  const humanFlag = opt(argv, "human");
  const withPrefix = (v: string, prefix: string) =>
    v.startsWith(prefix) ? v : `${prefix}${v}`;

  const config: CliConfig = {
    backend,
    agentId: agentFlag
      ? withPrefix(agentFlag, "agent:")
      : env.WERKNARIO_AGENT_ID || "agent:assistant",
    humanId: humanFlag
      ? withPrefix(humanFlag, "human:")
      : env.WERKNARIO_HUMAN || "human:you",
    autoApprove: flag(argv, "yes") || env.WERKNARIO_AUTO_APPROVE === "1",
    routing: flag(argv, "route") || env.WERKNARIO_ROUTE === "1",
    locale: flag(argv, "de") || env.WERKNARIO_LOCALE === "de" ? "de" : "en",
    auditPath: opt(argv, "audit") || env.WERKNARIO_AUDIT || ".werknario/audit.jsonl",
    policyPath: opt(argv, "policy") || env.WERKNARIO_POLICY || ".werknario/policy.json",
    dryRun: flag(argv, "dry-run") || env.WERKNARIO_DRY_RUN === "1",
  };

  const verifyCmd = opt(argv, "verify-cmd") || env.WERKNARIO_VERIFY_CMD;
  if (verifyCmd) config.verifyCmd = verifyCmd;

  const budget = opt(argv, "budget") || env.WERKNARIO_BUDGET_USD;
  if (budget) config.budgetUsd = Number(budget);
  const maxTurns = opt(argv, "max-turns");
  if (maxTurns) config.maxTurns = Number(maxTurns);

  if (backend === "mock") {
    return { task, config };
  }

  if (backend === "gitlab") {
    const token = env.GITLAB_TOKEN || env.GITLAB_PAT || "";
    const projectId = env.GITLAB_PROJECT_ID || "";
    const baseUrl = env.GITLAB_BASE_URL || "https://gitlab.com";
    if (!token || !projectId) {
      throw new Error(
        "GitLab backend needs GITLAB_TOKEN and GITLAB_PROJECT_ID (and optionally GITLAB_BASE_URL).",
      );
    }
    config.gitlab = { baseUrl, projectId, token };
  } else {
    const token = env.GITHUB_TOKEN || "";
    const repo = env.GITHUB_REPO || "";
    if (!token || !repo) {
      throw new Error("GitHub backend needs GITHUB_TOKEN and GITHUB_REPO (owner/repo).");
    }
    config.github = { repo, token, ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}) };
  }

  return { task, config };
}

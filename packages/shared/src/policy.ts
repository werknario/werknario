/**
 * Minimal permission model. Answers two questions a document org needs before it
 * trusts an agent with real files: which paths may this agent write, and who is
 * allowed to approve a change touching a given path. Kept deliberately small — a
 * JSON file (`.werknario/policy.json`) with glob rules, no roles engine. Pure and
 * portable; the executor enforces it via an optional write guard.
 *
 * Default is permissive: with no policy, or no entry for an agent, writes are
 * allowed. That keeps the tool working out of the box. Once a policy names an
 * agent, deny globs win over allow globs.
 */

export interface AgentPolicy {
  /** If present and non-empty, the agent may only write paths matching one of these. */
  allow?: string[];
  /** Paths the agent may never write. Wins over allow. */
  deny?: string[];
}

export interface WerknarioPolicy {
  agents?: Record<string, AgentPolicy>;
  /** Glob → list of human ids allowed to approve a change touching that path. */
  approvers?: Record<string, string[]>;
}

export interface WriteDecision {
  allowed: boolean;
  reason?: string;
}

/** Glob match: `**` spans slashes, `*` stays within one path segment. */
export function matchGlob(pattern: string, path: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`).test(path);
}

/** May this agent write this path? */
export function canWrite(
  policy: WerknarioPolicy,
  agentId: string,
  path: string,
): WriteDecision {
  const agent = policy.agents?.[agentId];
  if (!agent) return { allowed: true };

  // Normalize before matching so "vertraege//x.md" or "vertraege/x.md/" can't
  // slip a rule written for "vertraege/x.md".
  const p = normalizePath(path);

  if (agent.deny?.some((g) => matchGlob(g, p))) {
    return { allowed: false, reason: `Pfad "${path}" ist für ${agentId} gesperrt.` };
  }
  if (agent.allow && agent.allow.length > 0) {
    if (agent.allow.some((g) => matchGlob(g, p))) return { allowed: true };
    return {
      allowed: false,
      reason: `Pfad "${path}" liegt außerhalb der erlaubten Bereiche von ${agentId}.`,
    };
  }
  return { allowed: true };
}

function normalizePath(path: string): string {
  return path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

/**
 * Who may approve a change touching this path? Most specific glob wins.
 *
 * Enforced by the CLI merge gate via `checkApprover` below: a human not on the
 * list for a touched path is refused the merge. It is a real control only when
 * the human identity is authenticated (the CLI reads it from the backend token),
 * not self-declared; the web-IDE extension surface does not gate on it yet. See
 * docs/permissions.md.
 */
export function approversFor(policy: WerknarioPolicy, path: string): string[] {
  const matches = Object.entries(policy.approvers ?? {}).filter(([g]) =>
    matchGlob(g, path),
  );
  if (matches.length === 0) return [];
  matches.sort((a, b) => b[0].length - a[0].length);
  return matches[0]?.[1] ?? [];
}

export interface ApproverCheck {
  /** True when the human may approve every touched path that has an approver rule. */
  authorized: boolean;
  /** The touched paths whose approver rule the human does not satisfy. */
  unmetPaths: string[];
  /** The union of names that would satisfy the unmet paths. */
  requiredApprovers: string[];
}

/**
 * Decides whether a named human may approve a merge that touches these paths.
 * A path with a non-empty approver rule requires the human to be on that rule's
 * list; a path with no rule is unrestricted. This is the enforcement the older
 * `approversFor` only described: it is only meaningful when the human identity is
 * authenticated (from the backend token), not self-declared. The `human` may be
 * given with or without the `human:` prefix.
 */
export function checkApprover(
  policy: WerknarioPolicy,
  human: string,
  touchedPaths: string[],
): ApproverCheck {
  const bare = human.replace(/^human:/, "");
  const unmetPaths: string[] = [];
  const required = new Set<string>();
  for (const path of touchedPaths) {
    const approvers = approversFor(policy, path);
    if (approvers.length > 0 && !approvers.includes(bare)) {
      unmetPaths.push(path);
      for (const a of approvers) required.add(a);
    }
  }
  return {
    authorized: unmetPaths.length === 0,
    unmetPaths,
    requiredApprovers: [...required],
  };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validate untrusted input (a parsed policy file) into a WerknarioPolicy. */
export function parsePolicy(input: unknown): WerknarioPolicy {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Policy muss ein Objekt sein.");
  }
  const obj = input as Record<string, unknown>;
  const out: WerknarioPolicy = {};

  if (obj.agents !== undefined) {
    if (typeof obj.agents !== "object" || obj.agents === null || Array.isArray(obj.agents)) {
      throw new Error('Policy-Feld "agents" muss ein Objekt sein.');
    }
    const agents: Record<string, AgentPolicy> = {};
    for (const [name, raw] of Object.entries(obj.agents)) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`Policy: agents.${name} muss ein Objekt sein.`);
      }
      const ap = raw as Record<string, unknown>;
      const a: AgentPolicy = {};
      if (ap.allow !== undefined) {
        if (!isStringArray(ap.allow)) throw new Error(`Policy: agents.${name}.allow muss string[] sein.`);
        a.allow = ap.allow;
      }
      if (ap.deny !== undefined) {
        if (!isStringArray(ap.deny)) throw new Error(`Policy: agents.${name}.deny muss string[] sein.`);
        a.deny = ap.deny;
      }
      agents[name] = a;
    }
    out.agents = agents;
  }

  if (obj.approvers !== undefined) {
    if (typeof obj.approvers !== "object" || obj.approvers === null || Array.isArray(obj.approvers)) {
      throw new Error('Policy-Feld "approvers" muss ein Objekt sein.');
    }
    const approvers: Record<string, string[]> = {};
    for (const [glob, raw] of Object.entries(obj.approvers)) {
      if (!isStringArray(raw)) throw new Error(`Policy: approvers["${glob}"] muss string[] sein.`);
      approvers[glob] = raw;
    }
    out.approvers = approvers;
  }

  return out;
}

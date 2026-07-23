/**
 * Closing the loop: after the agent has proposed a change and a human approved
 * opening it, this drives the rest that "AI as an employee" implies — check for
 * conflicts, optionally verify (CI), let a human approve the merge, merge, and
 * offer a rollback. Every step is one audit entry, so the whole life of a change
 * is a verifiable chain, not a claim.
 *
 * The gateway is an interface so it works against GitLab, GitHub, or a fake in
 * tests. Verification beyond the conflict check is pluggable (a CI-status probe);
 * automatic post-merge rollback needs a running pipeline and is offered here as
 * an explicit, audited action rather than pretended.
 */

import {
  AuditLog,
  checkApprover,
  friendlyError,
  type Locale,
  type WerknarioPolicy,
} from "@werknario/shared";

export interface MergeGateway {
  /** Free of conflicts (and green, if the gateway also probes CI)? */
  checkMergeable(iid: number): Promise<{ mergeable: boolean; reason?: string }>;
  merge(iid: number): Promise<{ sha?: string }>;
  /** Propose undoing a merged change as a new branch/merge request. */
  revert(
    iid: number,
    sha: string | undefined,
  ): Promise<{ webUrl?: string; branch: string }>;
}

export interface CloseLoopDeps {
  gateway: MergeGateway;
  approveMerge: (iid: number) => Promise<boolean>;
  /** Extra check before merging, e.g. a CI-status probe. Optional. */
  verify?: (iid: number) => Promise<{ ok: boolean; detail?: string }>;
  out: (line: string) => void;
  audit: AuditLog;
  humanId: string;
  agentId: string;
  locale?: Locale;
  /** Permission policy, if one is loaded. Enables the approver gate below. */
  policy?: WerknarioPolicy;
  /** The paths this change touched, checked against the policy's approver rules. */
  touchedPaths?: string[];
}

export type CloseLoopResult =
  | {
      merged: false;
      reason: "conflict" | "declined" | "verify_failed" | "not_authorized";
      detail?: string;
    }
  | { merged: true; sha?: string };

export async function closeLoop(
  iid: number,
  deps: CloseLoopDeps,
): Promise<CloseLoopResult> {
  const { gateway, audit, humanId, agentId } = deps;

  // 1. Conflict check. Never merge a change that collides with a newer edit.
  const mergeable = await gateway.checkMergeable(iid);
  audit.append("system", "mergeable_check", {
    iid,
    mergeable: mergeable.mergeable,
    reason: mergeable.reason,
  });
  if (!mergeable.mergeable) {
    const f = friendlyError(
      { detail: mergeable.reason ?? "merge conflict" },
      deps.locale,
    );
    deps.out(`${f.message} ${f.hint}`);
    return { merged: false, reason: "conflict", detail: mergeable.reason };
  }

  // 2. Optional verification (e.g. CI green) before the merge.
  if (deps.verify) {
    const v = await deps.verify(iid);
    audit.append("system", "verify", { iid, ok: v.ok, detail: v.detail });
    if (!v.ok) {
      deps.out(
        `Verification did not pass, not merging. ${v.detail ?? ""}`.trim(),
      );
      return { merged: false, reason: "verify_failed", detail: v.detail };
    }
  }

  // 2.5 Authorised approver. If the policy names approvers for a touched path,
  // the acting human must be one of them. This is only a real control when
  // humanId is authenticated (from the backend token), not self-declared — the
  // CLI sets it from the token for GitLab/GitHub. The check runs before the
  // approval prompt, so an unauthorised human is refused, not merely recorded.
  if (deps.policy && deps.touchedPaths && deps.touchedPaths.length > 0) {
    const check = checkApprover(deps.policy, humanId, deps.touchedPaths);
    if (!check.authorized) {
      audit.append(humanId, "merge_denied", {
        iid,
        reason: "not_authorized",
        paths: check.unmetPaths,
        requiredApprovers: check.requiredApprovers,
      });
      deps.out(
        `Merge blocked: ${humanId.replace(/^human:/, "")} is not an authorised ` +
          `approver for ${check.unmetPaths.join(", ")}. ` +
          `Required: ${check.requiredApprovers.join(", ")}.`,
      );
      return {
        merged: false,
        reason: "not_authorized",
        detail: check.unmetPaths.join(", "),
      };
    }
  }

  // 3. A human approves the merge. This is the point of no automatic return.
  const ok = await deps.approveMerge(iid);
  audit.append(humanId, ok ? "approve_merge" : "decline_merge", { iid });
  if (!ok) return { merged: false, reason: "declined" };

  // 4. Merge.
  const res = await gateway.merge(iid);
  audit.append(agentId, "merge", { iid, sha: res.sha });
  deps.out(`Merged !${iid}.`);
  return { merged: true, ...(res.sha ? { sha: res.sha } : {}) };
}

/** Roll back a merged change by proposing a revert. Audited. */
export async function rollback(
  iid: number,
  sha: string | undefined,
  deps: Pick<CloseLoopDeps, "gateway" | "audit" | "humanId" | "out">,
): Promise<{ webUrl?: string; branch: string }> {
  const r = await deps.gateway.revert(iid, sha);
  deps.audit.append(deps.humanId, "rollback", {
    iid,
    sha,
    revertBranch: r.branch,
  });
  deps.out(`Rollback proposed on branch ${r.branch}. A human approves it like any other change.`);
  return r;
}

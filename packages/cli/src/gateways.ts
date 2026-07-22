/**
 * Adapters from the concrete GitLab/GitHub clients to the CLI's MergeGateway,
 * so closeLoop() works the same against either. Merge and revert are here (not on
 * the ToolBackend the agent sees): they are human-approved, CLI-driven steps.
 */

import type { GitlabClient } from "@werknario/gitlab-client";
import type { GitHubClient } from "@werknario/github-client";
import type { MergeGateway } from "./closeLoop.js";

/**
 * Fail-safe merge check: only merge when GitLab explicitly says the MR is
 * mergeable. Every other status (ci_still_running, discussions_not_resolved,
 * conflict, unchecked, draft, ...) blocks, so an unattended --yes run never
 * merges past a pipeline that has not finished or a review that is not done.
 */
export function gitlabGateway(api: GitlabClient): MergeGateway {
  return {
    async checkMergeable(iid) {
      const mr = await api.getMergeRequest(iid);
      const status = mr.detailed_merge_status ?? "unknown";
      const ok = status === "mergeable" || status === "can_be_merged";
      return ok ? { mergeable: true } : { mergeable: false, reason: status };
    },
    async merge(iid) {
      const mr = await api.mergeMergeRequest(iid);
      return mr.merge_commit_sha ? { sha: mr.merge_commit_sha } : {};
    },
    async revert(iid, sha) {
      const mr = await api.getMergeRequest(iid);
      const targetSha = sha ?? mr.merge_commit_sha ?? mr.sha;
      const branch = `revert/mr-${iid}`;
      await api.createBranch(branch, mr.target_branch);
      if (targetSha) await api.revertCommit(targetSha, branch);
      const revert = await api.createMergeRequest({
        sourceBranch: branch,
        targetBranch: mr.target_branch,
        title: `Revert !${iid}`,
        description: `Rollback of merge request !${iid}.`,
      });
      return { branch, webUrl: revert.web_url };
    },
  };
}

export function githubGateway(api: GitHubClient): MergeGateway {
  return {
    async checkMergeable(number) {
      const pr = await api.getPullRequest(number);
      // Only "clean" (mergeable, all required checks and reviews green) passes.
      // blocked / unstable / behind / draft / dirty / unknown all fail safe.
      const ok = pr.mergeable === true && pr.mergeable_state === "clean";
      return ok
        ? { mergeable: true }
        : { mergeable: false, reason: pr.mergeable_state ?? "unknown" };
    },
    async merge(number) {
      const r = await api.mergePullRequest(number, { method: "squash" });
      return r.sha ? { sha: r.sha } : {};
    },
    async revert(number, sha) {
      if (!sha) {
        throw new Error(
          "Rollback braucht den Merge-Commit-SHA aus dem Merge-Schritt. " +
            "Ohne ihn den Revert über die GitHub-Oberfläche auslösen.",
        );
      }
      const repo = await api.getRepo();
      const base = repo.default_branch;
      const branch = `revert/pr-${number}`;
      await api.revertViaBranch(branch, base, sha);
      const pr = await api.createPullRequest({
        head: branch,
        base,
        title: `Revert #${number}`,
        body: `Rollback of pull request #${number}.`,
      });
      return { branch, webUrl: pr.html_url };
    },
  };
}

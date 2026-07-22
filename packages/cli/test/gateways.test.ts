import { describe, expect, it, vi } from "vitest";
import type { GitlabClient } from "@werknario/gitlab-client";
import type { GitHubClient } from "@werknario/github-client";
import { gitlabGateway, githubGateway } from "../src/gateways.js";

describe("gitlabGateway", () => {
  it("reports a conflict as not mergeable", async () => {
    const api = {
      getMergeRequest: vi.fn(async () => ({ detailed_merge_status: "conflict", target_branch: "main" })),
    } as unknown as GitlabClient;
    expect(await gitlabGateway(api).checkMergeable(5)).toEqual({ mergeable: false, reason: "conflict" });
  });

  it("reports a mergeable MR as mergeable and returns the merge sha", async () => {
    const api = {
      getMergeRequest: vi.fn(async () => ({ detailed_merge_status: "mergeable", target_branch: "main" })),
      mergeMergeRequest: vi.fn(async () => ({ merge_commit_sha: "deadbeef" })),
    } as unknown as GitlabClient;
    const g = gitlabGateway(api);
    expect(await g.checkMergeable(5)).toEqual({ mergeable: true });
    expect(await g.merge(5)).toEqual({ sha: "deadbeef" });
  });

  it("fails safe: does not merge while CI is still running", async () => {
    const api = {
      getMergeRequest: vi.fn(async () => ({ detailed_merge_status: "ci_still_running", target_branch: "main" })),
    } as unknown as GitlabClient;
    expect(await gitlabGateway(api).checkMergeable(5)).toEqual({
      mergeable: false,
      reason: "ci_still_running",
    });
  });

  it("reverts by branching, reverting the commit, and opening a revert MR", async () => {
    const createBranch = vi.fn(async () => ({ name: "revert/mr-5" }));
    const revertCommit = vi.fn(async () => ({ id: "r", short_id: "r", web_url: "u" }));
    const createMergeRequest = vi.fn(async () => ({ web_url: "http://host/mr/9", iid: 9, source_branch: "revert/mr-5", target_branch: "main", title: "Revert !5" }));
    const api = {
      getMergeRequest: vi.fn(async () => ({ target_branch: "main", merge_commit_sha: "abc" })),
      createBranch,
      revertCommit,
      createMergeRequest,
    } as unknown as GitlabClient;
    const r = await gitlabGateway(api).revert(5, "abc");
    expect(r.branch).toBe("revert/mr-5");
    expect(revertCommit).toHaveBeenCalledWith("abc", "revert/mr-5");
    expect(r.webUrl).toBe("http://host/mr/9");
  });
});

describe("githubGateway", () => {
  it("treats mergeable_state 'dirty' as a conflict", async () => {
    const api = {
      getPullRequest: vi.fn(async () => ({ number: 3, mergeable: false, mergeable_state: "dirty" })),
    } as unknown as GitHubClient;
    expect(await githubGateway(api).checkMergeable(3)).toEqual({ mergeable: false, reason: "dirty" });
  });

  it("squash-merges and returns the sha", async () => {
    const mergePullRequest = vi.fn(async () => ({ sha: "cafef00d" }));
    const api = {
      getPullRequest: vi.fn(async () => ({ number: 3, mergeable: true, mergeable_state: "clean" })),
      mergePullRequest,
    } as unknown as GitHubClient;
    const g = githubGateway(api);
    expect(await g.checkMergeable(3)).toEqual({ mergeable: true });
    expect(await g.merge(3)).toEqual({ sha: "cafef00d" });
    expect(mergePullRequest).toHaveBeenCalledWith(3, { method: "squash" });
  });

  it("fails safe: does not merge a PR that is blocked by required checks", async () => {
    const api = {
      getPullRequest: vi.fn(async () => ({ number: 3, mergeable: true, mergeable_state: "blocked" })),
    } as unknown as GitHubClient;
    expect(await githubGateway(api).checkMergeable(3)).toEqual({
      mergeable: false,
      reason: "blocked",
    });
  });

  it("needs the merge sha to revert", async () => {
    const api = { getRepo: vi.fn() } as unknown as GitHubClient;
    await expect(githubGateway(api).revert(3, undefined)).rejects.toThrow(/Merge-Commit-SHA/);
  });
});

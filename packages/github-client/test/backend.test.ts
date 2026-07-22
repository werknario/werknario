import { describe, expect, it, vi } from "vitest";
import { GitHubRestBackend, type GitHubApi } from "../src/index.js";

function fakeApi(overrides: Partial<GitHubApi> = {}): GitHubApi {
  return {
    getRepo: vi.fn(async () => ({
      full_name: "acme/widgets",
      default_branch: "main",
    })),
    listTree: vi.fn(async () => [
      { type: "dir" as const, path: "vertraege" },
      { type: "file" as const, path: "README.md" },
    ]),
    getFileText: vi.fn(async () => "notiz inhalt"),
    fileExists: vi.fn(async () => false),
    createBranch: vi.fn(async (name: string) => ({ name })),
    commitFiles: vi.fn(async (branch: string) => ({ sha: "c1", branch })),
    createPullRequest: vi.fn(async (a) => ({
      number: 11,
      html_url: "http://gh/pr/11",
      head_ref: a.head,
      mergeable: null,
      mergeable_state: "unknown",
    })),
    getPullRequest: vi.fn(async (number: number) => ({
      number,
      html_url: "u",
      head_ref: "b",
      mergeable: true,
      mergeable_state: "clean",
    })),
    mergePullRequest: vi.fn(async () => ({ merged: true, sha: "merge-sha" })),
    createIssueComment: vi.fn(async () => ({ html_url: "http://gh/pr/11#comment" })),
    revertViaBranch: vi.fn(async (newBranch: string) => ({ name: newBranch })),
    ...overrides,
  };
}

describe("GitHubRestBackend", () => {
  it("init resolves the real default branch", async () => {
    const api = fakeApi({
      getRepo: vi.fn(async () => ({ full_name: "x/y", default_branch: "develop" })),
    });
    const backend = new GitHubRestBackend(api);
    await backend.init();
    await backend.readFile("a.md");
    expect(api.getFileText).toHaveBeenCalledWith("a.md", "develop");
  });

  it("marks dir entries with a trailing slash, leaves files alone", async () => {
    const backend = new GitHubRestBackend(fakeApi());
    const entries = await backend.listFiles("");
    expect(entries).toContain("vertraege/");
    expect(entries).toContain("README.md");
  });

  it("readFile prefers a staged proposal over the server copy", async () => {
    const api = fakeApi();
    const backend = new GitHubRestBackend(api);
    await backend.proposeEdit("x.md", "staged body", "s");
    const body = await backend.readFile("x.md");
    expect(body).toBe("staged body");
    expect(api.getFileText).not.toHaveBeenCalled();
  });

  it("proposeEdit flags a new file when it does not exist", async () => {
    const api = fakeApi({ fileExists: vi.fn(async () => false) });
    const backend = new GitHubRestBackend(api);
    const r = await backend.proposeEdit("new.md", "c", "s");
    expect(r.isNew).toBe(true);
    expect(backend.stagedCount).toBe(1);
  });

  it("proposeEdit flags an existing file as an update, not a new file", async () => {
    const api = fakeApi({ fileExists: vi.fn(async () => true) });
    const backend = new GitHubRestBackend(api);
    const r = await backend.proposeEdit("existing.md", "c", "s");
    expect(r.isNew).toBe(false);
  });

  it("createMergeRequest branches, commits all staged files in one call, opens the PR, and clears staging", async () => {
    const api = fakeApi({ fileExists: vi.fn(async () => false) });
    const backend = new GitHubRestBackend(api, "main");
    await backend.proposeEdit("vertraege/split.md", "# Split", "s");
    await backend.proposeEdit("vertraege/notiz.md", "notiz", "s");
    const res = await backend.createMergeRequest({
      title: "Split Sheet",
      description: "desc",
      sourceBranch: "split/landgang",
      closesIssueIid: 3,
    });
    expect(api.createBranch).toHaveBeenCalledWith("split/landgang", "main");

    const commitArgs = (api.commitFiles as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commitArgs?.[0]).toBe("split/landgang");
    expect(commitArgs?.[2]).toEqual(
      expect.arrayContaining([
        { path: "vertraege/split.md", content: "# Split" },
        { path: "vertraege/notiz.md", content: "notiz" },
      ]),
    );
    // Exactly one commitFiles call for both staged files - the atomicity guarantee.
    expect(api.commitFiles).toHaveBeenCalledTimes(1);

    const prArgs = (api.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prArgs?.[0].body).toContain("Closes #3");
    expect(prArgs?.[0].base).toBe("main");
    expect(prArgs?.[0].head).toBe("split/landgang");

    expect(res.iid).toBe(11);
    expect(res.webUrl).toBe("http://gh/pr/11");
    expect(backend.stagedCount).toBe(0);
  });

  it("createMergeRequest falls back to the resolved default branch when no target is given", async () => {
    const api = fakeApi({ fileExists: vi.fn(async () => false) });
    const backend = new GitHubRestBackend(api, "develop");
    await backend.proposeEdit("a.md", "x", "s");
    await backend.createMergeRequest({ title: "T", description: "D", sourceBranch: "feature" });
    expect(api.createBranch).toHaveBeenCalledWith("feature", "develop");
    const prArgs = (api.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prArgs?.[0].base).toBe("develop");
  });

  it("createMergeRequest refuses when nothing is staged", async () => {
    const backend = new GitHubRestBackend(fakeApi());
    await expect(
      backend.createMergeRequest({ title: "T", description: "D", sourceBranch: "b" }),
    ).rejects.toThrow(/Keine vorgeschlagenen/);
  });

  it("keeps isNew stable across repeated proposals and only queries fileExists once", async () => {
    const fileExists = vi.fn(async () => false);
    const api = fakeApi({ fileExists });
    const backend = new GitHubRestBackend(api, "main");
    const first = await backend.proposeEdit("new.md", "v1", "s");
    const second = await backend.proposeEdit("new.md", "v2", "s");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(true);
    expect(fileExists.mock.calls.length).toBe(1);
  });

  it("addComment delegates to createIssueComment for a merge_request target", async () => {
    const api = fakeApi();
    const backend = new GitHubRestBackend(api);
    const result = await backend.addComment({ targetType: "merge_request", iid: 5, body: "hi" });
    expect(api.createIssueComment).toHaveBeenCalledWith(5, "hi");
    expect(result).toEqual({});
  });

  it("addComment delegates to createIssueComment for an issue target too (GitHub has one endpoint)", async () => {
    const api = fakeApi();
    const backend = new GitHubRestBackend(api);
    await backend.addComment({ targetType: "issue", iid: 7, body: "hallo" });
    expect(api.createIssueComment).toHaveBeenCalledWith(7, "hallo");
  });
});

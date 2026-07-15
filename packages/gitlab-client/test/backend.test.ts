import { describe, expect, it, vi } from "vitest";
import { GitLabRestBackend, type GitlabApi } from "../src/index.js";

function fakeApi(overrides: Partial<GitlabApi> = {}): GitlabApi {
  return {
    getProject: vi.fn(async () => ({
      id: 124,
      path_with_namespace: "x/fleetlicht-demo",
      default_branch: "main",
      visibility: "private",
    })),
    listTree: vi.fn(async () => [
      { id: "1", name: "vertraege", type: "tree" as const, path: "vertraege" },
      { id: "2", name: "README.md", type: "blob" as const, path: "README.md" },
    ]),
    getFileText: vi.fn(async () => "notiz inhalt"),
    fileExists: vi.fn(async () => false),
    createBranch: vi.fn(async (name: string) => ({ name })),
    commit: vi.fn(async () => ({ id: "c1", short_id: "c1", web_url: "u" })),
    createMergeRequest: vi.fn(async (a) => ({
      iid: 11,
      web_url: "http://gl/mr/11",
      source_branch: a.sourceBranch,
      target_branch: a.targetBranch,
      title: a.title,
    })),
    getMergeRequest: vi.fn(async (iid: number) => ({
      iid,
      web_url: "u",
      source_branch: "b",
      target_branch: "main",
      title: "t",
    })),
    addNote: vi.fn(async () => ({ id: 1 })),
    ...overrides,
  };
}

describe("GitLabRestBackend", () => {
  it("init resolves the real default branch", async () => {
    const api = fakeApi({
      getProject: vi.fn(async () => ({
        id: 1,
        path_with_namespace: "x/y",
        default_branch: "develop",
        visibility: "private",
      })),
    });
    const backend = new GitLabRestBackend(api);
    await backend.init();
    await backend.readFile("a.md");
    expect(api.getFileText).toHaveBeenCalledWith("a.md", "develop");
  });

  it("marks tree entries with a trailing slash", async () => {
    const backend = new GitLabRestBackend(fakeApi());
    const entries = await backend.listFiles("");
    expect(entries).toContain("vertraege/");
    expect(entries).toContain("README.md");
  });

  it("readFile prefers a staged proposal over the server copy", async () => {
    const api = fakeApi();
    const backend = new GitLabRestBackend(api);
    await backend.proposeEdit("x.md", "staged body", "s");
    const body = await backend.readFile("x.md");
    expect(body).toBe("staged body");
    expect(api.getFileText).not.toHaveBeenCalled();
  });

  it("proposeEdit flags a new file when it does not exist", async () => {
    const api = fakeApi({ fileExists: vi.fn(async () => false) });
    const backend = new GitLabRestBackend(api);
    const r = await backend.proposeEdit("new.md", "c", "s");
    expect(r.isNew).toBe(true);
    expect(backend.stagedCount).toBe(1);
  });

  it("createMergeRequest branches, commits staged edits, opens the MR, and clears staging", async () => {
    const api = fakeApi({ fileExists: vi.fn(async () => false) });
    const backend = new GitLabRestBackend(api, "main");
    await backend.proposeEdit("vertraege/split.md", "# Split", "s");
    const res = await backend.createMergeRequest({
      title: "Split Sheet",
      description: "desc",
      sourceBranch: "split/landgang",
      closesIssueIid: 3,
    });
    expect(api.createBranch).toHaveBeenCalledWith("split/landgang", "main");
    const commitArgs = (api.commit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commitArgs?.[0]).toBe("split/landgang");
    expect(commitArgs?.[2][0]).toMatchObject({
      action: "create",
      file_path: "vertraege/split.md",
    });
    // Closes reference threaded into the description
    const mrArgs = (api.createMergeRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(mrArgs?.[0].description).toContain("Closes #3");
    expect(res.iid).toBe(11);
    expect(res.webUrl).toBe("http://gl/mr/11");
    expect(backend.stagedCount).toBe(0);
  });

  it("createMergeRequest refuses when nothing is staged", async () => {
    const backend = new GitLabRestBackend(fakeApi());
    await expect(
      backend.createMergeRequest({ title: "T", description: "D", sourceBranch: "b" }),
    ).rejects.toThrow(/Keine vorgeschlagenen/);
  });

  it("keeps isNew stable across repeated proposals and only queries once", async () => {
    const fileExists = vi.fn(async () => false);
    const api = fakeApi({ fileExists });
    const backend = new GitLabRestBackend(api, "main");
    const first = await backend.proposeEdit("new.md", "v1", "s");
    const second = await backend.proposeEdit("new.md", "v2", "s");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(true);
    expect(fileExists.mock.calls.length).toBe(1);
  });

  it("addComment delegates to addNote", async () => {
    const api = fakeApi();
    const backend = new GitLabRestBackend(api);
    await backend.addComment({ targetType: "merge_request", iid: 5, body: "hi" });
    expect(api.addNote).toHaveBeenCalledWith("merge_request", 5, "hi");
  });
});

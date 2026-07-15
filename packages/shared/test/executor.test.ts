import { describe, expect, it, vi } from "vitest";
import {
  assertSafeRepoPath,
  createToolExecutor,
  type ToolBackend,
  type ToolUseBlock,
} from "../src/index.js";

function fakeBackend(overrides: Partial<ToolBackend> = {}): ToolBackend {
  return {
    listFiles: vi.fn(async () => ["a.md", "b.md"]),
    readFile: vi.fn(async () => "file body"),
    proposeEdit: vi.fn(async (path: string) => ({ path, isNew: true })),
    createMergeRequest: vi.fn(async (args) => ({
      webUrl: "http://gitlab/mr/7",
      iid: 7,
      sourceBranch: args.sourceBranch,
    })),
    addComment: vi.fn(async () => ({ url: "http://gitlab/note/1" })),
    ...overrides,
  };
}

function use(name: string, input: Record<string, unknown>): ToolUseBlock {
  return { type: "tool_use", id: "tu", name, input };
}

describe("createToolExecutor", () => {
  it("lists files", async () => {
    const backend = fakeBackend();
    const exec = createToolExecutor(backend);
    const r = await exec(use("list_files", { path: "vertraege" }));
    expect(backend.listFiles).toHaveBeenCalledWith("vertraege");
    expect(r.content).toContain("a.md");
  });

  it("reads a file and truncates when over the cap", async () => {
    const backend = fakeBackend({ readFile: vi.fn(async () => "x".repeat(100)) });
    const exec = createToolExecutor(backend, { maxReadChars: 10 });
    const r = await exec(use("read_file", { path: "a.md" }));
    expect(r.content).toContain("gekürzt");
  });

  it("throws when read_file is missing its required path (loop turns this into an error result)", async () => {
    const exec = createToolExecutor(fakeBackend());
    await expect(exec(use("read_file", {}))).rejects.toThrow(/path/);
  });

  it("stages a proposed edit without committing", async () => {
    const backend = fakeBackend();
    const exec = createToolExecutor(backend);
    const r = await exec(
      use("propose_edit", { path: "x.md", content: "hi", summary: "s" }),
    );
    expect(backend.proposeEdit).toHaveBeenCalledWith("x.md", "hi", "s");
    expect(backend.createMergeRequest).not.toHaveBeenCalled();
    expect(r.content).toContain("Entwurf für x.md");
  });

  it("opens a merge request and reports the url", async () => {
    const backend = fakeBackend();
    const exec = createToolExecutor(backend);
    const r = await exec(
      use("create_merge_request", {
        title: "T",
        description: "D",
        source_branch: "split/x",
        closes_issue_iid: 3,
      }),
    );
    expect(backend.createMergeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBranch: "split/x", closesIssueIid: 3 }),
    );
    expect(r.content).toContain("http://gitlab/mr/7");
  });

  it("gates create_merge_request behind approval and does not run when declined", async () => {
    const backend = fakeBackend();
    const exec = createToolExecutor(backend, {
      onApprovalRequest: async () => false,
    });
    const r = await exec(
      use("create_merge_request", { title: "T", description: "D", source_branch: "b" }),
    );
    expect(backend.createMergeRequest).not.toHaveBeenCalled();
    expect(r.content).toContain("nicht bestätigt");
  });

  it("runs create_merge_request when approval is granted", async () => {
    const backend = fakeBackend();
    const approve = vi.fn(async () => true);
    const exec = createToolExecutor(backend, { onApprovalRequest: approve });
    await exec(use("create_merge_request", { title: "T", description: "D", source_branch: "b" }));
    expect(approve).toHaveBeenCalledOnce();
    expect(backend.createMergeRequest).toHaveBeenCalledOnce();
  });

  it("does not ask approval for reads and previews", async () => {
    const approve = vi.fn(async () => true);
    const exec = createToolExecutor(fakeBackend(), { onApprovalRequest: approve });
    await exec(use("read_file", { path: "a.md" }));
    await exec(use("list_files", { path: "" }));
    await exec(use("propose_edit", { path: "a.md", content: "c", summary: "s" }));
    expect(approve).not.toHaveBeenCalled();
  });

  it("validates add_comment target_type", async () => {
    const exec = createToolExecutor(fakeBackend());
    await expect(
      exec(use("add_comment", { target_type: "wiki", iid: 1, body: "x" })),
    ).rejects.toThrow(/target_type/);
  });

  it("returns an error result for an unknown tool", async () => {
    const exec = createToolExecutor(fakeBackend());
    const r = await exec(use("delete_everything", {}));
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Unbekanntes Werkzeug");
  });

  it("blocks path traversal on read_file / list_files / propose_edit before the backend runs", async () => {
    const backend = fakeBackend();
    const exec = createToolExecutor(backend);
    await expect(exec(use("read_file", { path: "../../secret.env" }))).rejects.toThrow(/\.\./);
    await expect(exec(use("list_files", { path: "../etc" }))).rejects.toThrow(/\.\./);
    await expect(
      exec(use("propose_edit", { path: "/etc/passwd", content: "x", summary: "s" })),
    ).rejects.toThrow(/[Aa]bsolut/);
    expect(backend.readFile).not.toHaveBeenCalled();
    expect(backend.listFiles).not.toHaveBeenCalled();
    expect(backend.proposeEdit).not.toHaveBeenCalled();
  });
});

describe("assertSafeRepoPath", () => {
  it("accepts normal repo-relative paths", () => {
    expect(() => assertSafeRepoPath("")).not.toThrow();
    expect(() => assertSafeRepoPath("vertraege/split-sheet.md")).not.toThrow();
    expect(() => assertSafeRepoPath("mock-substrate-musik/katalog/x.csv")).not.toThrow();
  });
  it("rejects .. segments, absolute paths, backslash escapes and null bytes", () => {
    expect(() => assertSafeRepoPath("../x")).toThrow();
    expect(() => assertSafeRepoPath("a/../../b")).toThrow();
    expect(() => assertSafeRepoPath("/etc/passwd")).toThrow();
    expect(() => assertSafeRepoPath("a\\..\\b")).toThrow();
    expect(() => assertSafeRepoPath("a\0b")).toThrow();
  });
});

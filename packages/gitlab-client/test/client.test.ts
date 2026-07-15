import { describe, expect, it } from "vitest";
import { GitlabClient, GitlabError, type FetchLike } from "../src/index.js";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(
  route: (url: string, method: string) => { status: number; body: unknown },
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      ...(init?.body !== undefined ? { body: init.body } : {}),
    });
    const { status, body } = route(url, init?.method ?? "GET");
    const isText = typeof body === "string";
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return isText ? (body as string) : JSON.stringify(body);
      },
      async json() {
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

const base = { baseUrl: "https://gl.test", token: "SECRET-TOKEN", projectId: 124 };

describe("GitlabClient", () => {
  it("sends the private token header and never leaks it in errors", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 500, body: "boom" }));
    const client = new GitlabClient({ ...base, fetchImpl });
    await expect(client.getProject()).rejects.toBeInstanceOf(GitlabError);
    expect(calls[0]?.headers["PRIVATE-TOKEN"]).toBe("SECRET-TOKEN");
    try {
      await client.getProject();
    } catch (e) {
      expect(String(e)).not.toContain("SECRET-TOKEN");
      expect((e as GitlabError).status).toBe(500);
    }
  });

  it("reads a file via the raw endpoint and returns text", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: "line1\nline2" }));
    const client = new GitlabClient({ ...base, fetchImpl });
    const text = await client.getFileText("dir/sub/notiz.md", "main");
    expect(text).toBe("line1\nline2");
    // path fully url-encoded, /raw suffix, ref as query
    expect(calls[0]?.url).toContain("/repository/files/dir%2Fsub%2Fnotiz.md/raw");
    expect(calls[0]?.url).toContain("ref=main");
  });

  it("fileExists returns false on 404 and true on 200", async () => {
    const notFound = makeFetch(() => ({ status: 404, body: "not found" }));
    const client404 = new GitlabClient({ ...base, fetchImpl: notFound.fetchImpl });
    expect(await client404.fileExists("missing.md", "main")).toBe(false);

    const ok = makeFetch(() => ({ status: 200, body: "x" }));
    const client200 = new GitlabClient({ ...base, fetchImpl: ok.fetchImpl });
    expect(await client200.fileExists("there.md", "main")).toBe(true);
  });

  it("creates a branch using query params (slash-safe)", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 201, body: { name: "split/x" } }));
    const client = new GitlabClient({ ...base, fetchImpl });
    await client.createBranch("split/landgang-entwurf", "main");
    const url = calls[0]?.url ?? "";
    expect(calls[0]?.method).toBe("POST");
    expect(url).toContain("/repository/branches");
    // slash-containing branch is in the query, not the path
    expect(url).toContain("branch=split%2Flandgang-entwurf");
    expect(url).toContain("ref=main");
  });

  it("commits actions with a text encoding default", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 201,
      body: { id: "abc", short_id: "abc", web_url: "u" },
    }));
    const client = new GitlabClient({ ...base, fetchImpl });
    await client.commit("split/x", "msg", [
      { action: "create", file_path: "a.md", content: "hi" },
    ]);
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.branch).toBe("split/x");
    expect(sent.commit_message).toBe("msg");
    expect(sent.actions[0]).toMatchObject({
      action: "create",
      file_path: "a.md",
      content: "hi",
      encoding: "text",
    });
  });

  it("opens a merge request with the snake_case body", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 201,
      body: { iid: 9, web_url: "http://mr/9", source_branch: "split/x", target_branch: "main", title: "T" },
    }));
    const client = new GitlabClient({ ...base, fetchImpl });
    const mr = await client.createMergeRequest({
      sourceBranch: "split/x",
      targetBranch: "main",
      title: "T",
      description: "D",
    });
    expect(mr.iid).toBe(9);
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.source_branch).toBe("split/x");
    expect(sent.target_branch).toBe("main");
  });

  it("adds a note to the right target segment", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 201, body: { id: 1 } }));
    const client = new GitlabClient({ ...base, fetchImpl });
    await client.addNote("issue", 3, "hallo");
    expect(calls[0]?.url).toContain("/issues/3/notes");
    await client.addNote("merge_request", 4, "hi");
    expect(calls[1]?.url).toContain("/merge_requests/4/notes");
  });
});

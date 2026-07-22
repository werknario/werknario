import { describe, expect, it } from "vitest";
import { GitHubClient, GitHubError, type FetchLike } from "../src/index.js";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * A stateless router: given the URL and method of a call, decide what to
 * answer. Good enough for the single-request tests; the multi-step Git Data
 * API flows (commitFiles, revertViaBranch) use a router that pattern-matches
 * on the endpoint shape, since the same client makes several different calls
 * in one operation.
 */
function makeFetch(
  route: (url: string, method: string, body?: string) => { status: number; body: unknown },
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: init?.headers ?? {},
      ...(init?.body !== undefined ? { body: init.body } : {}),
    });
    const { status, body } = route(url, method, init?.body);
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

const base = { token: "SECRET-TOKEN", repo: "acme/widgets" };

describe("GitHubClient - auth, errors, base config", () => {
  it("sends the bearer token and API version headers, never leaks the token in errors", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 500, body: "boom" }));
    const client = new GitHubClient({ ...base, fetchImpl });
    await expect(client.getRepo()).rejects.toBeInstanceOf(GitHubError);
    expect(calls[0]?.headers.Authorization).toBe("Bearer SECRET-TOKEN");
    expect(calls[0]?.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    try {
      await client.getRepo();
    } catch (e) {
      expect(String(e)).not.toContain("SECRET-TOKEN");
      expect((e as GitHubError).status).toBe(500);
    }
  });

  it("surfaces a short GitHub error detail so the model can self-correct", async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 422, body: "Reference already exists" }));
    const client = new GitHubClient({ ...base, fetchImpl });
    await expect(client.createBranch("split/x", "main")).rejects.toThrow(
      /Reference already exists/,
    );
  });

  it("defaults the base URL to api.github.com and hits /repos/{owner}/{repo}", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 200,
      body: { full_name: "acme/widgets", default_branch: "main" },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const repo = await client.getRepo();
    expect(repo.default_branch).toBe("main");
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/widgets");
  });
});

describe("GitHubClient - reading the tree and files", () => {
  it("listTree maps GitHub's dir/file types and preserves paths", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 200,
      body: [
        { type: "dir", path: "vertraege", name: "vertraege" },
        { type: "file", path: "README.md", name: "README.md" },
      ],
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const entries = await client.listTree("", "main");
    expect(entries).toEqual([
      { type: "dir", path: "vertraege" },
      { type: "file", path: "README.md" },
    ]);
    expect(calls[0]?.url).toContain("/repos/acme/widgets/contents");
    expect(calls[0]?.url).toContain("ref=main");
  });

  it("listTree normalizes a single-file response into a one-element array", async () => {
    const { fetchImpl } = makeFetch(() => ({
      status: 200,
      body: { type: "file", path: "README.md" },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const entries = await client.listTree("README.md", "main");
    expect(entries).toEqual([{ type: "file", path: "README.md" }]);
  });

  it("listTree keeps slashes as path segments, not %2F, for nested paths", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: [] }));
    const client = new GitHubClient({ ...base, fetchImpl });
    await client.listTree("dir/sub", "main");
    expect(calls[0]?.url).toContain("/contents/dir/sub");
    expect(calls[0]?.url).not.toContain("%2F");
  });

  it("getFileText decodes base64 content when the server answers with contents JSON", async () => {
    const encoded = Buffer.from("line1\nline2", "utf-8").toString("base64");
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 200,
      body: { type: "file", path: "dir/sub/notiz.md", encoding: "base64", content: encoded },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const text = await client.getFileText("dir/sub/notiz.md", "main");
    expect(text).toBe("line1\nline2");
    expect(calls[0]?.url).toContain("/contents/dir/sub/notiz.md");
    expect(calls[0]?.headers.Accept).toBe("application/vnd.github.raw+json");
  });

  it("getFileText returns the body as-is when the raw media type answers directly", async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 200, body: "raw file bytes" }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const text = await client.getFileText("notiz.md", "main");
    expect(text).toBe("raw file bytes");
  });

  it("fileExists returns false on 404 and true on 200", async () => {
    const notFound = makeFetch(() => ({ status: 404, body: "not found" }));
    const client404 = new GitHubClient({ ...base, fetchImpl: notFound.fetchImpl });
    expect(await client404.fileExists("missing.md", "main")).toBe(false);

    const ok = makeFetch(() => ({ status: 200, body: "x" }));
    const client200 = new GitHubClient({ ...base, fetchImpl: ok.fetchImpl });
    expect(await client200.fileExists("there.md", "main")).toBe(true);
  });
});

describe("GitHubClient - branches", () => {
  it("createBranch resolves the source ref's sha, then creates the new ref pointing at it", async () => {
    const { fetchImpl, calls } = makeFetch((url, method) => {
      if (method === "GET" && url.includes("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "base-sha" } } };
      }
      return { status: 201, body: { ref: "refs/heads/split/x", object: { sha: "base-sha" } } };
    });
    const client = new GitHubClient({ ...base, fetchImpl });
    const branch = await client.createBranch("split/landgang", "main");
    expect(branch).toEqual({ name: "split/landgang" });

    const getRefCall = calls.find((c) => c.method === "GET");
    expect(getRefCall?.url).toContain("/git/ref/heads/main");

    const createRefCall = calls.find((c) => c.method === "POST");
    const sent = JSON.parse(createRefCall?.body ?? "{}");
    expect(sent.ref).toBe("refs/heads/split/landgang");
    expect(sent.sha).toBe("base-sha");
  });
});

describe("GitHubClient - commitFiles (atomic multi-file commit)", () => {
  function makeCommitFlowFetch() {
    return makeFetch((url, method, body) => {
      if (method === "GET" && url.includes("/git/ref/heads/split/x")) {
        return { status: 200, body: { object: { sha: "branch-tip-sha" } } };
      }
      if (method === "GET" && url.includes("/git/commits/branch-tip-sha")) {
        return {
          status: 200,
          body: { sha: "branch-tip-sha", tree: { sha: "base-tree-sha" }, parents: [] },
        };
      }
      if (method === "POST" && url.endsWith("/git/blobs")) {
        const parsed = JSON.parse(body ?? "{}");
        return { status: 201, body: { sha: `blob-${parsed.content.length}` } };
      }
      if (method === "POST" && url.endsWith("/git/trees")) {
        return { status: 201, body: { sha: "new-tree-sha" } };
      }
      if (method === "POST" && url.endsWith("/git/commits")) {
        return {
          status: 201,
          body: { sha: "new-commit-sha", tree: { sha: "new-tree-sha" }, parents: [{ sha: "branch-tip-sha" }] },
        };
      }
      if (method === "PATCH" && url.includes("/git/refs/heads/split/x")) {
        return { status: 200, body: { object: { sha: "new-commit-sha" } } };
      }
      throw new Error(`unexpected call ${method} ${url}`);
    });
  }

  it("commits two files as exactly one commit (blob -> tree -> commit -> ref update)", async () => {
    const { fetchImpl, calls } = makeCommitFlowFetch();
    const client = new GitHubClient({ ...base, fetchImpl });
    const result = await client.commitFiles("split/x", "Split Sheet\n\ndesc", [
      { path: "vertraege/split.md", content: "# Split" },
      { path: "vertraege/notiz.md", content: "notiz" },
    ]);
    expect(result).toEqual({ sha: "new-commit-sha", branch: "split/x" });

    const blobCalls = calls.filter((c) => c.method === "POST" && c.url.endsWith("/git/blobs"));
    expect(blobCalls).toHaveLength(2);

    const treeCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/git/trees"));
    const treeSent = JSON.parse(treeCall?.body ?? "{}");
    expect(treeSent.base_tree).toBe("base-tree-sha");
    expect(treeSent.tree).toHaveLength(2);
    expect(treeSent.tree[0]).toMatchObject({
      path: "vertraege/split.md",
      mode: "100644",
      type: "blob",
    });

    // Exactly one commit call - the atomicity guarantee.
    const commitCalls = calls.filter((c) => c.method === "POST" && c.url.endsWith("/git/commits"));
    expect(commitCalls).toHaveLength(1);
    const commitSent = JSON.parse(commitCalls[0]?.body ?? "{}");
    expect(commitSent.tree).toBe("new-tree-sha");
    expect(commitSent.parents).toEqual(["branch-tip-sha"]);

    const refCall = calls.find((c) => c.method === "PATCH");
    const refSent = JSON.parse(refCall?.body ?? "{}");
    expect(refSent.sha).toBe("new-commit-sha");
  });
});

describe("GitHubClient - pull requests", () => {
  it("creates a pull request and maps head.ref to head_ref", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 201,
      body: {
        number: 9,
        html_url: "http://gh/pr/9",
        head: { ref: "split/x" },
        mergeable: null,
        mergeable_state: "unknown",
      },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const pr = await client.createPullRequest({
      head: "split/x",
      base: "main",
      title: "T",
      body: "D",
    });
    expect(pr).toEqual({
      number: 9,
      html_url: "http://gh/pr/9",
      head_ref: "split/x",
      mergeable: null,
      mergeable_state: "unknown",
    });
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.head).toBe("split/x");
    expect(sent.base).toBe("main");
  });

  it("getPullRequest surfaces mergeable and mergeable_state for conflict detection", async () => {
    const { fetchImpl } = makeFetch(() => ({
      status: 200,
      body: {
        number: 9,
        html_url: "http://gh/pr/9",
        head: { ref: "split/x" },
        mergeable: false,
        mergeable_state: "dirty",
      },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const pr = await client.getPullRequest(9);
    expect(pr.mergeable).toBe(false);
    expect(pr.mergeable_state).toBe("dirty");
  });

  it("mergePullRequest defaults to squash", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 200,
      body: { merged: true, sha: "merge-sha" },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const result = await client.mergePullRequest(9);
    expect(result.merged).toBe(true);
    expect(calls[0]?.url).toContain("/pulls/9/merge");
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.merge_method).toBe("squash");
  });

  it("mergePullRequest respects an explicit merge method", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: { merged: true } }));
    const client = new GitHubClient({ ...base, fetchImpl });
    await client.mergePullRequest(9, { method: "rebase" });
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.merge_method).toBe("rebase");
  });
});

describe("GitHubClient - comments", () => {
  it("createIssueComment posts to the issues endpoint (shared by PRs)", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      status: 201,
      body: { html_url: "http://gh/pr/9#comment" },
    }));
    const client = new GitHubClient({ ...base, fetchImpl });
    const comment = await client.createIssueComment(9, "hallo");
    expect(comment.html_url).toBe("http://gh/pr/9#comment");
    expect(calls[0]?.url).toContain("/issues/9/comments");
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.body).toBe("hallo");
  });
});

describe("GitHubClient - revertViaBranch (simplified revert)", () => {
  it("reverts to the pre-merge tree, applied on top of the current base tip", async () => {
    const { fetchImpl, calls } = makeFetch((url, method) => {
      if (method === "GET" && url.includes("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "main-tip-sha" } } };
      }
      if (method === "GET" && url.includes("/git/commits/merge-commit-sha")) {
        return {
          status: 200,
          body: {
            sha: "merge-commit-sha",
            tree: { sha: "merge-tree-sha" },
            parents: [{ sha: "parent-sha" }],
          },
        };
      }
      if (method === "GET" && url.includes("/git/commits/parent-sha")) {
        return {
          status: 200,
          body: { sha: "parent-sha", tree: { sha: "parent-tree-sha" }, parents: [] },
        };
      }
      if (method === "POST" && url.endsWith("/git/commits")) {
        return {
          status: 201,
          body: {
            sha: "revert-commit-sha",
            tree: { sha: "parent-tree-sha" },
            parents: [{ sha: "main-tip-sha" }],
          },
        };
      }
      if (method === "POST" && url.endsWith("/git/refs")) {
        return { status: 201, body: { ref: "refs/heads/revert/x", object: { sha: "revert-commit-sha" } } };
      }
      throw new Error(`unexpected call ${method} ${url}`);
    });
    const client = new GitHubClient({ ...base, fetchImpl });
    const branch = await client.revertViaBranch("revert/x", "main", "merge-commit-sha");
    expect(branch).toEqual({ name: "revert/x" });

    const commitCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/git/commits"));
    const commitSent = JSON.parse(commitCall?.body ?? "{}");
    // Tree comes from the PARENT of the reverted commit (pre-merge state)...
    expect(commitSent.tree).toBe("parent-tree-sha");
    // ...but it's stacked on the CURRENT base tip, not the old merge commit.
    expect(commitSent.parents).toEqual(["main-tip-sha"]);

    const refCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/git/refs"));
    const refSent = JSON.parse(refCall?.body ?? "{}");
    expect(refSent.ref).toBe("refs/heads/revert/x");
    expect(refSent.sha).toBe("revert-commit-sha");
  });

  it("refuses to revert a commit with no parent (repository root commit)", async () => {
    const { fetchImpl } = makeFetch((url, method) => {
      if (method === "GET" && url.includes("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "main-tip-sha" } } };
      }
      if (method === "GET" && url.includes("/git/commits/root-sha")) {
        return { status: 200, body: { sha: "root-sha", tree: { sha: "root-tree" }, parents: [] } };
      }
      throw new Error(`unexpected call ${method} ${url}`);
    });
    const client = new GitHubClient({ ...base, fetchImpl });
    await expect(client.revertViaBranch("revert/x", "main", "root-sha")).rejects.toThrow(
      /no parent/,
    );
  });
});

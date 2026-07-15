import { describe, expect, it, vi } from "vitest";
import type { GitlabApi } from "@werknario/gitlab-client";
import { createProxyCaller } from "../src/proxyClient.js";
import { readConfig } from "../src/config.js";
import { resolveGitlabToken } from "../src/auth.js";
import { getWebviewHtml } from "../src/webview.js";
import { VSCodeBackend, type WorkspaceFs } from "../src/vscodeBackend.js";

describe("createProxyCaller", () => {
  it("POSTs the request with a bearer token and returns the parsed response", async () => {
    const calls: Array<{ url: string; init: unknown }> = [];
    const fetchImpl = async (url: string, init?: unknown) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async text() {
          return "";
        },
        async json() {
          return { role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
        },
      };
    };
    const call = createProxyCaller({ url: "http://proxy/", token: "BEARER", fetchImpl });
    const res = await call({ messages: [{ role: "user", content: "hi" }] });
    expect(res.stop_reason).toBe("end_turn");
    const init = calls[0]?.init as { method: string; headers: Record<string, string>; body: string };
    expect(calls[0]?.url).toBe("http://proxy/v1/agent/message");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer BEARER");
    expect(JSON.parse(init.body).messages[0].content).toBe("hi");
  });

  it("throws a helpful error on a non-ok proxy response", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 502,
      async text() {
        return "provider down";
      },
      async json() {
        return {};
      },
    });
    const call = createProxyCaller({ url: "http://proxy", token: "x", fetchImpl });
    await expect(call({ messages: [] })).rejects.toThrow(/502/);
  });
});

describe("readConfig", () => {
  it("accepts a complete config", () => {
    const { config, error } = readConfig({
      proxyUrl: "http://p",
      proxyToken: "t",
      gitlabBaseUrl: "http://g",
      projectId: "124",
      gitlabPat: "",
    });
    expect(error).toBeUndefined();
    expect(config?.projectId).toBe("124");
    expect(config?.gitlabPat).toBeUndefined();
  });

  it("names the missing settings", () => {
    const { error } = readConfig({ proxyUrl: "http://p" });
    expect(error).toContain("werknario.proxyToken");
    expect(error).toContain("werknario.gitlabBaseUrl");
    expect(error).toContain("werknario.projectId");
  });
});

describe("resolveGitlabToken", () => {
  it("uses the Web IDE session token when present", async () => {
    const r = await resolveGitlabToken(async () => "web-ide-tok");
    expect(r).toEqual({ token: "web-ide-tok", source: "web-ide" });
  });
  it("falls back to a PAT when the session yields nothing", async () => {
    const r = await resolveGitlabToken(async () => undefined, "pat-tok");
    expect(r).toEqual({ token: "pat-tok", source: "pat" });
  });
  it("treats a throwing session getter as no session", async () => {
    const r = await resolveGitlabToken(async () => {
      throw new Error("no provider");
    }, "pat-tok");
    expect(r.source).toBe("pat");
  });
  it("throws with guidance when neither is available", async () => {
    await expect(resolveGitlabToken(async () => undefined)).rejects.toThrow(/gitlabPat/);
  });
});

describe("getWebviewHtml", () => {
  it("embeds the nonce and a CSP, and has the chat controls", () => {
    const html = getWebviewHtml("vscode-resource:", "NONCE123");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-NONCE123");
    expect(html).toContain('id="input"');
    expect(html).toContain('id="send"');
    expect(html).toContain("acquireVsCodeApi");
  });
});

function fakeApi(over: Partial<GitlabApi> = {}): GitlabApi {
  return {
    getProject: vi.fn(async () => ({
      id: 124,
      path_with_namespace: "x/fleetlicht-demo",
      default_branch: "main",
      visibility: "private",
    })),
    listTree: vi.fn(async () => []),
    getFileText: vi.fn(async () => "server body"),
    fileExists: vi.fn(async () => false),
    createBranch: vi.fn(async (name: string) => ({ name })),
    commit: vi.fn(async () => ({ id: "c", short_id: "c", web_url: "u" })),
    createMergeRequest: vi.fn(async (a) => ({
      iid: 5,
      web_url: "http://mr/5",
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
    ...over,
  };
}

function memoryFs(initial: Record<string, string> = {}): WorkspaceFs & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async writeFile(p, content) {
      files.set(p, content);
    },
    async readDirectory() {
      return [{ name: "README.md", isDir: false }];
    },
    async exists(p) {
      return files.has(p);
    },
  };
}

describe("VSCodeBackend", () => {
  it("proposeEdit writes into the IDE filesystem and stages the change", async () => {
    const fs = memoryFs();
    const backend = new VSCodeBackend(fs, fakeApi(), "main");
    const r = await backend.proposeEdit("vertraege/split.md", "# Split", "s");
    expect(r.isNew).toBe(true);
    // written into the working copy so the human sees a diff
    expect(fs.files.get("vertraege/split.md")).toBe("# Split");
    // and readFile now returns the staged content
    expect(await backend.readFile("vertraege/split.md")).toBe("# Split");
  });

  it("createMergeRequest commits staged edits via REST and opens the MR", async () => {
    const fs = memoryFs();
    const api = fakeApi();
    const backend = new VSCodeBackend(fs, api, "main");
    await backend.proposeEdit("vertraege/split.md", "# Split", "s");
    const res = await backend.createMergeRequest({
      title: "Split Sheet",
      description: "desc",
      sourceBranch: "split/landgang",
    });
    expect(api.createBranch).toHaveBeenCalledWith("split/landgang", "main");
    expect(api.commit).toHaveBeenCalledOnce();
    expect(res.webUrl).toBe("http://mr/5");
  });

  it("marks an existing file as an update, not a create", async () => {
    const fs = memoryFs({ "README.md": "old" });
    const api = fakeApi({ fileExists: vi.fn() });
    const backend = new VSCodeBackend(fs, api, "main");
    const r = await backend.proposeEdit("README.md", "new", "s");
    expect(r.isNew).toBe(false);
  });

  it("keeps isNew=true when the same new file is proposed twice (no create->update flip)", async () => {
    const fs = memoryFs();
    const backend = new VSCodeBackend(fs, fakeApi(), "main");
    const first = await backend.proposeEdit("vertraege/draft.md", "v1", "s");
    const second = await backend.proposeEdit("vertraege/draft.md", "v2", "s");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(true);
    expect(fs.files.get("vertraege/draft.md")).toBe("v2");
  });
});

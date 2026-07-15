/**
 * A small GitLab REST client built on fetch, so it runs both in Node (the
 * headless end-to-end test) and in the browser extension host (opening the MR
 * with the user's Web IDE token). It covers exactly what the agent needs:
 * read the repo, create a branch, commit, open a merge request, add a note.
 *
 * Lessons baked in from the prior manual staging:
 *  - branch names with slashes go in query params, never as path segments
 *  - the file path is fully URL-encoded (slashes become %2F)
 *  - errors never carry the token
 */

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface GitlabClientOptions {
  baseUrl: string;
  token: string;
  /** numeric id or the URL-encoded "group/project" path */
  projectId: string | number;
  fetchImpl?: FetchLike;
}

export interface GitlabProject {
  id: number;
  path_with_namespace: string;
  default_branch: string;
  visibility: string;
}

export interface GitlabTreeEntry {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
}

export interface CommitAction {
  action: "create" | "update" | "delete" | "move";
  file_path: string;
  content?: string;
  encoding?: "text" | "base64";
  previous_path?: string;
}

export interface GitlabCommit {
  id: string;
  short_id: string;
  web_url: string;
}

export interface GitlabMergeRequest {
  iid: number;
  web_url: string;
  source_branch: string;
  target_branch: string;
  title: string;
  detailed_merge_status?: string;
}

export interface GitlabBranch {
  name: string;
}

export interface GitlabNote {
  id: number;
}

export class GitlabError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
    this.name = "GitlabError";
  }
}

export interface GitlabApi {
  getProject(): Promise<GitlabProject>;
  listTree(path: string, ref?: string): Promise<GitlabTreeEntry[]>;
  getFileText(path: string, ref?: string): Promise<string>;
  fileExists(path: string, ref?: string): Promise<boolean>;
  createBranch(branch: string, ref: string): Promise<GitlabBranch>;
  commit(
    branch: string,
    message: string,
    actions: CommitAction[],
  ): Promise<GitlabCommit>;
  createMergeRequest(args: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
  }): Promise<GitlabMergeRequest>;
  getMergeRequest(iid: number): Promise<GitlabMergeRequest>;
  addNote(
    targetType: "issue" | "merge_request",
    iid: number,
    body: string,
  ): Promise<GitlabNote>;
}

export class GitlabClient implements GitlabApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly projectBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GitlabClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.projectBase = `/projects/${encodeURIComponent(String(opts.projectId))}`;
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const impl = opts.fetchImpl ?? globalFetch;
    if (!impl) {
      throw new Error("No fetch implementation available; pass fetchImpl.");
    }
    this.fetchImpl = impl;
  }

  private buildUrl(apiPath: string, query?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}/api/v4${apiPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async req<T>(
    method: string,
    apiPath: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { "PRIVATE-TOKEN": this.token };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await this.fetchImpl(this.buildUrl(apiPath, opts.query), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new GitlabError(
        `GitLab ${method} ${apiPath} → ${res.status}`,
        res.status,
        detail,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  getProject(): Promise<GitlabProject> {
    return this.req<GitlabProject>("GET", this.projectBase);
  }

  listTree(path: string, ref?: string): Promise<GitlabTreeEntry[]> {
    return this.req<GitlabTreeEntry[]>(
      "GET",
      `${this.projectBase}/repository/tree`,
      { query: { path: path || undefined, ref, per_page: 100 } },
    );
  }

  async getFileText(path: string, ref?: string): Promise<string> {
    const url = this.buildUrl(
      `${this.projectBase}/repository/files/${encodeURIComponent(path)}/raw`,
      { ref },
    );
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { "PRIVATE-TOKEN": this.token },
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new GitlabError(
        `GitLab GET file ${path} → ${res.status}`,
        res.status,
        detail,
      );
    }
    return res.text();
  }

  async fileExists(path: string, ref?: string): Promise<boolean> {
    try {
      await this.getFileText(path, ref);
      return true;
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return false;
      throw e;
    }
  }

  createBranch(branch: string, ref: string): Promise<GitlabBranch> {
    // branch and ref as query params so slashes in names don't break the path
    return this.req<GitlabBranch>(
      "POST",
      `${this.projectBase}/repository/branches`,
      { query: { branch, ref } },
    );
  }

  commit(
    branch: string,
    message: string,
    actions: CommitAction[],
  ): Promise<GitlabCommit> {
    return this.req<GitlabCommit>("POST", `${this.projectBase}/repository/commits`, {
      body: {
        branch,
        commit_message: message,
        actions: actions.map((a) => ({ encoding: "text", ...a })),
      },
    });
  }

  createMergeRequest(args: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
  }): Promise<GitlabMergeRequest> {
    return this.req<GitlabMergeRequest>("POST", `${this.projectBase}/merge_requests`, {
      body: {
        source_branch: args.sourceBranch,
        target_branch: args.targetBranch,
        title: args.title,
        description: args.description,
      },
    });
  }

  getMergeRequest(iid: number): Promise<GitlabMergeRequest> {
    return this.req<GitlabMergeRequest>(
      "GET",
      `${this.projectBase}/merge_requests/${iid}`,
    );
  }

  addNote(
    targetType: "issue" | "merge_request",
    iid: number,
    body: string,
  ): Promise<GitlabNote> {
    const seg = targetType === "issue" ? "issues" : "merge_requests";
    return this.req<GitlabNote>(
      "POST",
      `${this.projectBase}/${seg}/${iid}/notes`,
      { body: { body } },
    );
  }
}

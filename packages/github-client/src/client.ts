/**
 * A small GitHub REST client built on fetch, mirroring @werknario/gitlab-client
 * so the agent's tool layer can target GitHub through the same ToolBackend
 * contract (see backend.ts). Covers exactly what the agent needs: read the
 * repo, create a branch, commit multiple files atomically, open a pull
 * request, add a comment, merge, and - in a deliberately simplified form -
 * revert.
 *
 * Carried over from the GitLab client:
 *  - errors never carry the token
 *  - "GitLab merge request" <-> "GitHub pull request" vocabulary is
 *    translated in backend.ts, not here; this file speaks GitHub's own terms
 *
 * What GitHub needs that GitLab didn't: there is no single "commit several
 * files" endpoint. An atomic multi-file commit goes through the Git Data API
 * (blob -> tree -> commit -> ref update); see commitFiles().
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

export interface GitHubClientOptions {
  /** default "https://api.github.com"; override for GitHub Enterprise Server */
  baseUrl?: string;
  token: string;
  /** "owner/repo" */
  repo: string;
  fetchImpl?: FetchLike;
}

export interface GitHubRepo {
  full_name: string;
  default_branch: string;
}

export interface GitHubTreeEntry {
  type: "dir" | "file";
  path: string;
}

export interface GitHubBranch {
  name: string;
}

export interface GitHubCommitFile {
  path: string;
  content: string;
}

export interface GitHubCommitResult {
  sha: string;
  branch: string;
}

export interface GitHubPullRequest {
  number: number;
  html_url: string;
  head_ref: string;
  /** null while GitHub is still computing mergeability; poll again. */
  mergeable?: boolean | null;
  mergeable_state?: string;
}

export interface GitHubMergeResult {
  merged: boolean;
  sha?: string;
  message?: string;
}

export interface GitHubComment {
  html_url?: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * A short, bounded slice of GitHub's error body appended to the error
 * message, so the model reading the tool_result can self-correct (e.g. "Reference
 * already exists" -> pick another branch name). GitHub operation errors are
 * not secrets; still capped to keep the model's context tight. The full body
 * stays on `.detail`.
 */
function shortDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "";
  const oneLine = trimmed.replace(/\s+/g, " ");
  return `: ${oneLine.slice(0, 200)}`;
}

/**
 * GitHub's contents/refs endpoints take slash-separated segments literally
 * as path segments (e.g. /contents/dir/sub/file.md). That's the opposite of
 * GitLab's single-segment /files/{path} route, which needs the whole path
 * percent-encoded (slashes become %2F). Encode each segment on its own so a
 * "/" in a file path or branch name stays a path separator.
 */
function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * Isomorphic base64 -> UTF-8 decode (Node and the extension's browser host
 * both need this): prefer atob + TextDecoder where available, fall back to
 * Buffer. GitHub's base64 content field is wrapped at ~60 chars; strip the
 * newlines first.
 */
function decodeBase64(base64: string): string {
  const cleaned = base64.replace(/\n/g, "");
  const g = globalThis as {
    atob?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  if (typeof g.atob === "function") {
    const binary = g.atob(cleaned);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  if (g.Buffer) return g.Buffer.from(cleaned, "base64").toString("utf-8");
  throw new Error("No base64 decoder available in this environment.");
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface RawGitRef {
  object: { sha: string };
}

interface RawGitCommit {
  sha: string;
  tree: { sha: string };
  parents: { sha: string }[];
}

interface RawGitBlob {
  sha: string;
}

interface RawGitTree {
  sha: string;
}

interface RawPullRequest {
  number: number;
  html_url: string;
  head: { ref: string };
  mergeable?: boolean | null;
  mergeable_state?: string;
}

interface RawContentsEntry {
  type: string;
  path: string;
}

interface RawContentsFile {
  encoding?: string;
  content?: string;
}

function mapPullRequest(pr: RawPullRequest): GitHubPullRequest {
  return {
    number: pr.number,
    html_url: pr.html_url,
    head_ref: pr.head.ref,
    mergeable: pr.mergeable,
    mergeable_state: pr.mergeable_state,
  };
}

export interface GitHubApi {
  getRepo(): Promise<GitHubRepo>;
  listTree(path: string, ref?: string): Promise<GitHubTreeEntry[]>;
  getFileText(path: string, ref?: string): Promise<string>;
  fileExists(path: string, ref?: string): Promise<boolean>;
  createBranch(branch: string, fromRef: string): Promise<GitHubBranch>;
  commitFiles(
    branch: string,
    message: string,
    files: GitHubCommitFile[],
  ): Promise<GitHubCommitResult>;
  createPullRequest(args: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<GitHubPullRequest>;
  getPullRequest(number: number): Promise<GitHubPullRequest>;
  mergePullRequest(
    number: number,
    opts?: { method?: "merge" | "squash" | "rebase" },
  ): Promise<GitHubMergeResult>;
  createIssueComment(number: number, body: string): Promise<GitHubComment>;
  /**
   * Simplified revert: creates `newBranch` on top of `base`'s current tip,
   * with its tree force-set back to whatever `commitSha` had BEFORE it was
   * applied (i.e. its first parent's tree).
   *
   * This is NOT a real `git revert` - there is no three-way merge. If `base`
   * picked up unrelated, legitimate changes after `commitSha` landed, this
   * wipes those out too, since it swaps the whole tree rather than inverting
   * commitSha's specific diff. Good enough for "undo the merge we just did
   * a moment ago"; do not reach for this as a general-purpose revert tool.
   */
  revertViaBranch(
    newBranch: string,
    base: string,
    commitSha: string,
  ): Promise<GitHubBranch>;
}

export class GitHubClient implements GitHubApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly repoPath: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GitHubClientOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.token = opts.token;
    this.repoPath = opts.repo
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const impl = opts.fetchImpl ?? globalFetch;
    if (!impl) {
      throw new Error("No fetch implementation available; pass fetchImpl.");
    }
    this.fetchImpl = impl;
  }

  private buildUrl(apiPath: string, query?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${apiPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private authHeaders(accept = "application/vnd.github+json"): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async req<T>(
    method: string,
    apiPath: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const headers = this.authHeaders();
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
      throw new GitHubError(
        `GitHub ${method} ${apiPath} → ${res.status}${shortDetail(detail)}`,
        res.status,
        detail,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private contentsPath(path: string): string {
    const encoded = encodeRepoPath(path);
    return `/repos/${this.repoPath}/contents${encoded ? `/${encoded}` : ""}`;
  }

  /** "heads/<branch>", each segment encoded but slashes kept as separators. */
  private refSegment(branch: string): string {
    return `heads/${encodeRepoPath(branch)}`;
  }

  private async getRefSha(branch: string): Promise<string> {
    const data = await this.req<RawGitRef>(
      "GET",
      `/repos/${this.repoPath}/git/ref/${this.refSegment(branch)}`,
    );
    return data.object.sha;
  }

  private async createRef(branch: string, sha: string): Promise<GitHubBranch> {
    await this.req("POST", `/repos/${this.repoPath}/git/refs`, {
      body: { ref: `refs/heads/${branch}`, sha },
    });
    return { name: branch };
  }

  getRepo(): Promise<GitHubRepo> {
    return this.req<GitHubRepo>("GET", `/repos/${this.repoPath}`);
  }

  async listTree(path: string, ref?: string): Promise<GitHubTreeEntry[]> {
    const data = await this.req<RawContentsEntry | RawContentsEntry[]>(
      "GET",
      this.contentsPath(path),
      { query: { ref } },
    );
    // The contents endpoint returns an array for a directory and a single
    // object for a file; normalize to an array either way.
    const entries = Array.isArray(data) ? data : [data];
    return entries.map((e) => ({
      type: e.type === "dir" ? "dir" : "file",
      path: e.path,
    }));
  }

  async getFileText(path: string, ref?: string): Promise<string> {
    // The raw media type hands back the file's bytes directly - no base64
    // decoding, and (unlike the default JSON contents response) it works for
    // files over GitHub's 1MB base64 limit. If whatever answers on the other
    // end ignores the Accept header and returns the normal contents JSON
    // instead, fall back to decoding its base64 `content` field.
    const res = await this.fetchImpl(this.buildUrl(this.contentsPath(path), { ref }), {
      method: "GET",
      headers: this.authHeaders("application/vnd.github.raw+json"),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new GitHubError(
        `GitHub GET file ${path} → ${res.status}${shortDetail(detail)}`,
        res.status,
        detail,
      );
    }
    const text = await res.text();
    const parsed = tryParseJson(text) as RawContentsFile | undefined;
    if (parsed && parsed.encoding === "base64" && typeof parsed.content === "string") {
      return decodeBase64(parsed.content);
    }
    return text;
  }

  async fileExists(path: string, ref?: string): Promise<boolean> {
    try {
      await this.getFileText(path, ref);
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return false;
      throw e;
    }
  }

  async createBranch(branch: string, fromRef: string): Promise<GitHubBranch> {
    const sha = await this.getRefSha(fromRef);
    return this.createRef(branch, sha);
  }

  async commitFiles(
    branch: string,
    message: string,
    files: GitHubCommitFile[],
  ): Promise<GitHubCommitResult> {
    const baseSha = await this.getRefSha(branch);
    const baseCommit = await this.req<RawGitCommit>(
      "GET",
      `/repos/${this.repoPath}/git/commits/${baseSha}`,
    );
    const blobs = await Promise.all(
      files.map((f) =>
        this.req<RawGitBlob>("POST", `/repos/${this.repoPath}/git/blobs`, {
          body: { content: f.content, encoding: "utf-8" },
        }),
      ),
    );
    const tree = await this.req<RawGitTree>("POST", `/repos/${this.repoPath}/git/trees`, {
      body: {
        base_tree: baseCommit.tree.sha,
        tree: files.map((f, i) => {
          const blob = blobs[i];
          if (!blob) throw new Error(`Missing blob for ${f.path}`);
          return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
        }),
      },
    });
    const commit = await this.req<RawGitCommit>("POST", `/repos/${this.repoPath}/git/commits`, {
      body: { message, tree: tree.sha, parents: [baseSha] },
    });
    // Fast-forward the branch ref to the new commit - this is the one step
    // that turns the blob/tree/commit trio into a real, atomic, single commit
    // on `branch`, exactly like GitLab's one-shot /repository/commits call.
    await this.req("PATCH", `/repos/${this.repoPath}/git/refs/${this.refSegment(branch)}`, {
      body: { sha: commit.sha },
    });
    return { sha: commit.sha, branch };
  }

  async createPullRequest(args: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<GitHubPullRequest> {
    const pr = await this.req<RawPullRequest>("POST", `/repos/${this.repoPath}/pulls`, {
      body: { title: args.title, head: args.head, base: args.base, body: args.body },
    });
    return mapPullRequest(pr);
  }

  async getPullRequest(number: number): Promise<GitHubPullRequest> {
    const pr = await this.req<RawPullRequest>("GET", `/repos/${this.repoPath}/pulls/${number}`);
    return mapPullRequest(pr);
  }

  mergePullRequest(
    number: number,
    opts: { method?: "merge" | "squash" | "rebase" } = {},
  ): Promise<GitHubMergeResult> {
    return this.req<GitHubMergeResult>("PUT", `/repos/${this.repoPath}/pulls/${number}/merge`, {
      body: { merge_method: opts.method ?? "squash" },
    });
  }

  createIssueComment(number: number, body: string): Promise<GitHubComment> {
    // PRs are issues under the hood on GitHub; there is no separate
    // "merge request note" endpoint like on GitLab.
    return this.req<GitHubComment>("POST", `/repos/${this.repoPath}/issues/${number}/comments`, {
      body: { body },
    });
  }

  async revertViaBranch(
    newBranch: string,
    base: string,
    commitSha: string,
  ): Promise<GitHubBranch> {
    const baseSha = await this.getRefSha(base);
    const commit = await this.req<RawGitCommit>(
      "GET",
      `/repos/${this.repoPath}/git/commits/${commitSha}`,
    );
    const parentSha = commit.parents[0]?.sha;
    if (!parentSha) {
      // Not an HTTP failure - a logic-level guard against an unrevertable
      // commit - so this is a plain Error, not a GitHubError.
      throw new Error(
        `Commit ${commitSha} has no parent; cannot revert a repository's root commit this way.`,
      );
    }
    const parentCommit = await this.req<RawGitCommit>(
      "GET",
      `/repos/${this.repoPath}/git/commits/${parentSha}`,
    );
    const revertCommit = await this.req<RawGitCommit>(
      "POST",
      `/repos/${this.repoPath}/git/commits`,
      {
        body: {
          message:
            `Revert "${commitSha}"\n\n` +
            `Resets the tree to its state before ${commitSha}, applied on top of the ` +
            `current ${base} tip. This is a tree swap, not a three-way revert: any ` +
            `unrelated changes made to ${base} after ${commitSha} landed are reverted too.`,
          tree: parentCommit.tree.sha,
          parents: [baseSha],
        },
      },
    );
    return this.createRef(newBranch, revertCommit.sha);
  }
}

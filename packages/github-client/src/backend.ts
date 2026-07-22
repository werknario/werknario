import type {
  AddCommentArgs,
  AddCommentResult,
  CreateMergeRequestArgs,
  CreateMergeRequestResult,
  ProposeEditResult,
  ToolBackend,
} from "@werknario/shared";
import type { GitHubApi, GitHubCommitFile } from "./client.js";

interface StagedEdit {
  content: string;
  isNew: boolean;
}

/**
 * A ToolBackend backed entirely by the GitHub REST API - the GitHub sibling
 * of GitLabRestBackend, with the same staging + one-commit-per-request shape.
 *
 * Vocabulary mapping: GitLab's "merge request" is GitHub's "pull request";
 * `iid` is the PR/issue number; `sourceBranch` is the head branch.
 * `closesIssueIid` is threaded into the PR body as "Closes #<n>", GitHub's
 * own convention for auto-closing an issue on merge.
 *
 * GitHub has no separate merge-request-note endpoint - a pull request IS an
 * issue for commenting purposes - so addComment always calls
 * createIssueComment regardless of targetType.
 */
export class GitHubRestBackend implements ToolBackend {
  private readonly staged = new Map<string, StagedEdit>();
  private ref: string;

  constructor(
    private readonly api: GitHubApi,
    /** default branch to read from and target; resolved from the repo if omitted */
    defaultBranch?: string,
  ) {
    this.ref = defaultBranch ?? "main";
  }

  /** Resolve the real default branch once, so reads and PRs target the right ref. */
  async init(): Promise<void> {
    const repo = await this.api.getRepo();
    this.ref = repo.default_branch;
  }

  async listFiles(path: string): Promise<string[]> {
    const entries = await this.api.listTree(path, this.ref);
    return entries.map((e) => (e.type === "dir" ? `${e.path}/` : e.path));
  }

  async readFile(path: string): Promise<string> {
    const staged = this.staged.get(path);
    if (staged) return staged.content;
    return this.api.getFileText(path, this.ref);
  }

  async proposeEdit(
    path: string,
    content: string,
    _summary: string,
  ): Promise<ProposeEditResult> {
    // Cache the new-vs-update decision from the first propose_edit so repeated
    // proposals of the same path stay consistent (and skip a redundant lookup).
    const existing = this.staged.get(path);
    const isNew = existing ? existing.isNew : !(await this.api.fileExists(path, this.ref));
    this.staged.set(path, { content, isNew });
    return { path, isNew };
  }

  async createMergeRequest(
    args: CreateMergeRequestArgs,
  ): Promise<CreateMergeRequestResult> {
    if (this.staged.size === 0) {
      throw new Error(
        "Keine vorgeschlagenen Änderungen zum Committen. Nutze zuerst propose_edit.",
      );
    }
    const target = args.targetBranch ?? this.ref;
    await this.api.createBranch(args.sourceBranch, target);

    const files: GitHubCommitFile[] = [...this.staged.entries()].map(([path, edit]) => ({
      path,
      content: edit.content,
    }));
    const message = `${args.title}\n\n${args.description}`.trim();
    await this.api.commitFiles(args.sourceBranch, message, files);

    const body = args.closesIssueIid
      ? `${args.description}\n\nCloses #${args.closesIssueIid}`
      : args.description;
    const pr = await this.api.createPullRequest({
      head: args.sourceBranch,
      base: target,
      title: args.title,
      body,
    });

    this.staged.clear();
    return { webUrl: pr.html_url, iid: pr.number, sourceBranch: pr.head_ref };
  }

  async addComment(args: AddCommentArgs): Promise<AddCommentResult> {
    await this.api.createIssueComment(args.iid, args.body);
    return {};
  }

  /** For tests/inspection: how many edits are staged but not yet committed. */
  get stagedCount(): number {
    return this.staged.size;
  }
}

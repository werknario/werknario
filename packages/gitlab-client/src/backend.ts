import type {
  AddCommentArgs,
  AddCommentResult,
  CreateMergeRequestArgs,
  CreateMergeRequestResult,
  ProposeEditResult,
  ToolBackend,
} from "@werknario/shared";
import type { CommitAction, GitlabApi } from "./client.js";

interface StagedEdit {
  content: string;
  isNew: boolean;
}

/**
 * A ToolBackend backed entirely by the GitLab REST API. This is the headless
 * path: it needs no browser and no VS Code, so the end-to-end test can drive
 * the whole agent flow against a real GitLab. In the Web IDE the extension uses
 * a different backend for reading and diff preview, but the commit + merge
 * request path is exactly this — the Web IDE's own "Commit" button calls the
 * same endpoint.
 */
export class GitLabRestBackend implements ToolBackend {
  private readonly staged = new Map<string, StagedEdit>();
  private ref: string;

  constructor(
    private readonly api: GitlabApi,
    /** default branch to read from and target; resolved from the project if omitted */
    defaultBranch?: string,
  ) {
    this.ref = defaultBranch ?? "main";
  }

  /** Resolve the real default branch once, so reads and MRs target the right ref. */
  async init(): Promise<void> {
    const project = await this.api.getProject();
    this.ref = project.default_branch;
  }

  async listFiles(path: string): Promise<string[]> {
    const entries = await this.api.listTree(path, this.ref);
    return entries.map((e) => (e.type === "tree" ? `${e.path}/` : e.path));
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

    const actions: CommitAction[] = [...this.staged.entries()].map(
      ([file_path, edit]) => ({
        action: edit.isNew ? "create" : "update",
        file_path,
        content: edit.content,
        encoding: "text",
      }),
    );
    const message = `${args.title}\n\n${args.description}`.trim();
    await this.api.commit(args.sourceBranch, message, actions);

    const description = args.closesIssueIid
      ? `${args.description}\n\nCloses #${args.closesIssueIid}`
      : args.description;
    const mr = await this.api.createMergeRequest({
      sourceBranch: args.sourceBranch,
      targetBranch: target,
      title: args.title,
      description,
    });

    this.staged.clear();
    return { webUrl: mr.web_url, iid: mr.iid, sourceBranch: mr.source_branch };
  }

  async addComment(args: AddCommentArgs): Promise<AddCommentResult> {
    await this.api.addNote(args.targetType, args.iid, args.body);
    return {};
  }

  /** For tests/inspection: how many edits are staged but not yet committed. */
  get stagedCount(): number {
    return this.staged.size;
  }
}

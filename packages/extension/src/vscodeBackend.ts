import type {
  AddCommentArgs,
  AddCommentResult,
  CreateMergeRequestArgs,
  CreateMergeRequestResult,
  ProposeEditResult,
  ToolBackend,
} from "@werknario/shared";
import type { CommitAction, GitlabApi } from "@werknario/gitlab-client";

/**
 * The slice of the filesystem the backend needs. In the Web IDE this wraps
 * vscode.workspace.fs (which reads/writes the GitLab-backed virtual FS); in
 * tests it's a plain in-memory fake. Paths are relative to the repo root.
 */
export interface WorkspaceFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDirectory(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
  exists(path: string): Promise<boolean>;
}

interface StagedEdit {
  content: string;
  isNew: boolean;
}

/**
 * ToolBackend for the Web IDE. Reads and previews go through the IDE
 * filesystem, so a propose_edit shows up as a real diff the human can see. The
 * commit itself goes through the GitLab REST API with the in-memory staged
 * content (Spike D decision): the Web IDE's own commit uses the same endpoint,
 * so this is the real mechanism, and it lets the agent own the branch/MR flow.
 */
export class VSCodeBackend implements ToolBackend {
  private readonly staged = new Map<string, StagedEdit>();

  constructor(
    private readonly fs: WorkspaceFs,
    private readonly api: GitlabApi,
    private readonly ref: string,
  ) {}

  async listFiles(path: string): Promise<string[]> {
    const entries = await this.fs.readDirectory(path);
    const prefix = path ? `${path.replace(/\/+$/, "")}/` : "";
    return entries.map((e) => `${prefix}${e.name}${e.isDir ? "/" : ""}`);
  }

  async readFile(path: string): Promise<string> {
    const staged = this.staged.get(path);
    if (staged) return staged.content;
    return this.fs.readFile(path);
  }

  async proposeEdit(
    path: string,
    content: string,
    _summary: string,
  ): Promise<ProposeEditResult> {
    const isNew = !(await this.fs.exists(path));
    // Write into the IDE working copy so the human sees the change as a diff.
    await this.fs.writeFile(path, content);
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
    await this.api.commit(
      args.sourceBranch,
      `${args.title}\n\n${args.description}`.trim(),
      actions,
    );

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
}

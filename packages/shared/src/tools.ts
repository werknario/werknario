import type { ToolDefinition } from "./types.js";

/** Canonical tool names. Kept as a const object so callers get autocompletion. */
export const TOOL = {
  LIST_FILES: "list_files",
  READ_FILE: "read_file",
  PROPOSE_EDIT: "propose_edit",
  CREATE_MERGE_REQUEST: "create_merge_request",
  ADD_COMMENT: "add_comment",
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/**
 * The tools Claude may call. The extension executes them; the model only asks.
 * Reading and previewing a proposed edit are cheap and reversible, so they are
 * ungated. Anything that writes to GitLab (opening an MR, posting a comment)
 * requires an explicit human confirmation — see isApprovalRequired.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: TOOL.LIST_FILES,
    description:
      "List files and folders in the repository. Use to discover what exists before reading. Returns paths relative to the repo root.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Folder path relative to the repo root. Omit or empty string for the root.",
        },
      },
    },
  },
  {
    name: TOOL.READ_FILE,
    description:
      "Read the full text of a file in the repository. Use before proposing an edit so you work from the real content. The result is returned with line numbers (L1, L2, …) so you can cite exact line spans as [Beleg: <path>:L<start>-L<end>].",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the repo root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: TOOL.PROPOSE_EDIT,
    description:
      "Propose the full new content of a file. This writes the proposal into the editor so the human sees it as a diff. It does NOT commit anything. Call create_merge_request afterwards to turn confirmed proposals into a merge request. For a new file, use a path that does not exist yet.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Target file path relative to the repo root (existing file to change, or a new path to create).",
        },
        content: {
          type: "string",
          description: "The complete new content of the file.",
        },
        summary: {
          type: "string",
          description:
            "One short sentence, in German, describing what this edit does. Shown to the human next to the diff.",
        },
      },
      required: ["path", "content", "summary"],
    },
  },
  {
    name: TOOL.CREATE_MERGE_REQUEST,
    description:
      "Commit all confirmed proposed edits to a new branch and open a merge request against the target branch. Requires human confirmation. Use a descriptive German title. Reference the related issue in the description if there is one.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Merge request title, in German." },
        description: {
          type: "string",
          description:
            "Merge request description, in German. Explain what changed and why. Every factual claim about the substrate (names, numbers, shares, dates) must cite its source as [Beleg: <path>:L<start>-L<end>], using only files you read this session. Citations to an unread file or non-existent lines are rejected and the merge request is not opened.",
        },
        source_branch: {
          type: "string",
          description:
            "Name of the new branch to create for the change, e.g. 'split/landgang-entwurf'.",
        },
        target_branch: {
          type: "string",
          description: "Branch to merge into. Defaults to the repo default branch.",
        },
        closes_issue_iid: {
          type: "number",
          description:
            "Optional issue iid this MR resolves; adds a 'Closes #N' reference.",
        },
      },
      required: ["title", "description", "source_branch"],
    },
  },
  {
    name: TOOL.ADD_COMMENT,
    description:
      "Post a comment on an issue or merge request. Requires human confirmation because it is visible to the whole team. Write in German.",
    input_schema: {
      type: "object",
      properties: {
        target_type: {
          type: "string",
          enum: ["issue", "merge_request"],
          description: "Whether to comment on an issue or a merge request.",
        },
        iid: {
          type: "number",
          description: "The iid of the issue or merge request.",
        },
        body: {
          type: "string",
          description:
            "The comment text, in German. Any factual claim about the substrate must cite its source as [Beleg: <path>:L<start>-L<end>], using only files you read this session; broken citations are rejected and the comment is not posted.",
        },
      },
      required: ["target_type", "iid", "body"],
    },
  },
];

/**
 * Tools that write something visible to the team and therefore need an explicit
 * human OK before the extension carries them out. Reading and previewing do not.
 */
export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<string> = new Set([
  TOOL.CREATE_MERGE_REQUEST,
  TOOL.ADD_COMMENT,
]);

export function isApprovalRequired(toolName: string): boolean {
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}

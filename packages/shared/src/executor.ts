import { isApprovalRequired } from "./tools.js";
import {
  ReadLedger,
  countLines,
  describeProblems,
  formatReadResult,
  validateCitations,
} from "./grounding.js";
import { formatSearchResults, searchSubstrate } from "./search.js";
import type { ToolExecutionResult, ToolExecutor } from "./loop.js";
import type { ToolUseBlock } from "./types.js";

/**
 * What a tool actually does. The dispatch logic and the approval gate live here
 * (tested once); the side effects live behind this interface. The extension
 * implements it with VS Code + GitLab APIs; the headless end-to-end test
 * implements it with the GitLab REST client. Same executor, different backend.
 *
 * A backend instance is per conversation and is allowed to hold state — most
 * importantly the set of proposed edits, which propose_edit stages and
 * create_merge_request commits.
 */
export interface ToolBackend {
  /** Paths (files and folders) directly under `path`, relative to the repo root. */
  listFiles(path: string): Promise<string[]>;
  /** Full text of a file. */
  readFile(path: string): Promise<string>;
  /** Stage a proposed file write and surface it to the human as a diff. Does not commit. */
  proposeEdit(
    path: string,
    content: string,
    summary: string,
  ): Promise<ProposeEditResult>;
  /** Commit all staged proposals to a new branch and open a merge request. */
  createMergeRequest(args: CreateMergeRequestArgs): Promise<CreateMergeRequestResult>;
  /** Post a comment on an issue or merge request. */
  addComment(args: AddCommentArgs): Promise<AddCommentResult>;
}

export interface ProposeEditResult {
  path: string;
  /** true if the path did not exist before (a new file). */
  isNew: boolean;
}

export interface CreateMergeRequestArgs {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch?: string;
  closesIssueIid?: number;
}

export interface CreateMergeRequestResult {
  webUrl: string;
  iid: number;
  sourceBranch: string;
}

export interface AddCommentArgs {
  targetType: "issue" | "merge_request";
  iid: number;
  body: string;
}

export interface AddCommentResult {
  url?: string;
}

export interface ToolExecutorOptions {
  /**
   * Called before an approval-required tool (create_merge_request, add_comment)
   * runs. Return false to decline. If omitted, such tools run without asking —
   * appropriate for headless tests, never for the real extension.
   */
  onApprovalRequest?: (toolUse: ToolUseBlock) => Promise<boolean>;
  /** Cap read_file / list_files output length so a huge file cannot blow the context. */
  maxReadChars?: number;
}

const DEFAULT_MAX_READ_CHARS = 60_000;

/**
 * Reject any path that could escape the repo root. File content flows into the
 * model, so a prompt-injected substrate file must not be able to talk the agent
 * into reading `../../other-project/.env`. Enforced centrally here, before any
 * backend runs, so it covers every tool and both backends.
 */
export function assertSafeRepoPath(path: string): void {
  if (path.includes("\0")) throw new Error("Ungültiger Pfad (Null-Byte).");
  if (path.startsWith("/")) {
    throw new Error(`Absolute Pfade sind nicht erlaubt: ${path}`);
  }
  for (const seg of path.split(/[\\/]/)) {
    if (seg === "." || seg === "..") {
      throw new Error(`Pfad darf keine "." oder ".." Segmente enthalten: ${path}`);
    }
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Pflichtfeld "${key}" fehlt oder ist leer.`);
  }
  return v;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [gekürzt, ${text.length - max} Zeichen ausgelassen]`;
}

/**
 * Turn the injected backend into a ToolExecutor the agent loop can drive.
 * Validates each tool's input, enforces the human-approval gate for
 * team-visible writes, and formats a plain-text tool_result the model reads back.
 */
export function createToolExecutor(
  backend: ToolBackend,
  options: ToolExecutorOptions = {},
): ToolExecutor {
  const maxRead = options.maxReadChars ?? DEFAULT_MAX_READ_CHARS;
  // Was in dieser Konversation gelesen wurde. Der Zitat-Kontrakt prüft Belege
  // dagegen: der Agent darf nur belegen, was er wirklich gelesen hat.
  const ledger = new ReadLedger();

  return async (toolUse: ToolUseBlock): Promise<ToolExecutionResult> => {
    const input = toolUse.input ?? {};

    // Grounding-Gate: teamsichtbare Schreibvorgänge dürfen keine Quelle nennen,
    // die der Agent nie gelesen hat. Läuft VOR der Mensch-Genehmigung, damit ein
    // erfundener Beleg gar nicht erst zur Bestätigung vorgelegt wird.
    const groundedText =
      toolUse.name === "create_merge_request"
        ? asString(input["description"])
        : toolUse.name === "add_comment"
          ? asString(input["body"])
          : undefined;
    if (groundedText !== undefined) {
      const { problems } = validateCitations(groundedText, ledger);
      if (problems.length > 0) {
        const was =
          toolUse.name === "create_merge_request"
            ? "Der Merge Request wurde NICHT geöffnet"
            : "Der Kommentar wurde NICHT gepostet";
        return {
          content: `${was}. Die Belege stimmen nicht:\n${describeProblems(problems)}\nLies die belegte Datei mit read_file und korrigiere die Belege (Format [Beleg: <pfad>:L<start>-L<ende>]), dann erneut versuchen.`,
          isError: true,
        };
      }
    }

    if (isApprovalRequired(toolUse.name) && options.onApprovalRequest) {
      const approved = await options.onApprovalRequest(toolUse);
      if (!approved) {
        return {
          content: `Der Nutzer hat "${toolUse.name}" nicht bestätigt. Frag nach, was am Vorschlag geändert werden soll, bevor du es erneut versuchst.`,
        };
      }
    }

    switch (toolUse.name) {
      case "list_files": {
        const path = asString(input["path"]);
        assertSafeRepoPath(path);
        const entries = await backend.listFiles(path);
        const listing = entries.length ? entries.join("\n") : "(leer)";
        return { content: truncate(listing, maxRead) };
      }

      case "search_files": {
        const query = requireString(input, "query");
        const path = asString(input["path"]);
        assertSafeRepoPath(path);
        // Suche ist Fund, kein Beleg: sie zeichnet nichts im Ledger auf. Der
        // Agent liest die gefundene Datei danach mit read_file und belegt erst dann.
        const result = await searchSubstrate(backend, query, path);
        return { content: formatSearchResults(query, result) };
      }

      case "read_file": {
        const path = requireString(input, "path");
        assertSafeRepoPath(path);
        const text = truncate(await backend.readFile(path), maxRead);
        // Nur die Zeilen aufzeichnen, die der Agent tatsächlich sieht: belegt er
        // eine Zeile jenseits der (ggf. gekürzten) Länge, wird das abgewiesen.
        ledger.record(path, countLines(text));
        return { content: formatReadResult(path, text) };
      }

      case "propose_edit": {
        const path = requireString(input, "path");
        assertSafeRepoPath(path);
        const content = requireString(input, "content");
        const summary = asString(input["summary"]) || "(ohne Beschreibung)";
        const res = await backend.proposeEdit(path, content, summary);
        const kind = res.isNew ? "neue Datei" : "geänderte Datei";
        return {
          content: `Entwurf für ${res.path} vorgelegt (${kind}). Der Mensch sieht den Diff. Wenn alles passt, öffne mit create_merge_request einen Merge Request.`,
        };
      }

      case "create_merge_request": {
        const title = requireString(input, "title");
        const description = asString(input["description"]);
        const sourceBranch = requireString(input, "source_branch");
        const targetBranch = asString(input["target_branch"]) || undefined;
        const closesRaw = input["closes_issue_iid"];
        const closesIssueIid =
          typeof closesRaw === "number" ? closesRaw : undefined;
        const res = await backend.createMergeRequest({
          title,
          description,
          sourceBranch,
          ...(targetBranch ? { targetBranch } : {}),
          ...(closesIssueIid ? { closesIssueIid } : {}),
        });
        return {
          content: `Merge Request !${res.iid} geöffnet auf Branch ${res.sourceBranch}: ${res.webUrl}`,
        };
      }

      case "add_comment": {
        const targetTypeRaw = requireString(input, "target_type");
        if (targetTypeRaw !== "issue" && targetTypeRaw !== "merge_request") {
          throw new Error(
            `target_type muss "issue" oder "merge_request" sein, war "${targetTypeRaw}".`,
          );
        }
        const iidRaw = input["iid"];
        if (typeof iidRaw !== "number") {
          throw new Error(`Pflichtfeld "iid" fehlt oder ist keine Zahl.`);
        }
        const body = requireString(input, "body");
        const res = await backend.addComment({
          targetType: targetTypeRaw,
          iid: iidRaw,
          body,
        });
        return { content: `Kommentar gepostet.${res.url ? " " + res.url : ""}` };
      }

      default:
        return {
          content: `Unbekanntes Werkzeug "${toolUse.name}".`,
          isError: true,
        };
    }
  };
}

import * as vscode from "vscode";
import {
  assertSafeRepoPath,
  buildSystemPrompt,
  createToolExecutor,
  runAgentLoop,
  TOOL_DEFINITIONS,
  type LlmCaller,
  type Message,
  type ToolExecutor,
  type ToolUseBlock,
} from "@werknario/shared";

/** Built once per chat panel and reused across messages, so the conversation and
 * the staged edits survive a "propose -> human replies to confirm" round-trip. */
interface AgentSession {
  executeTool: ToolExecutor;
  callLlm: LlmCaller;
  system: string;
  /** GitLab project path (e.g. "x/fleetlicht-demo"), used as the audit chain's genesis. */
  projectPath: string;
}
import { GitlabClient } from "@werknario/gitlab-client";
import { ExtensionAuditLog } from "./audit.js";
import { resolveGitlabToken } from "./auth.js";
import { readConfig, type AgentConfig } from "./config.js";
import { createProxyCaller } from "./proxyClient.js";
import { getWebviewHtml } from "./webview.js";
import { VSCodeBackend, type WorkspaceFs } from "./vscodeBackend.js";

const WEB_IDE_AUTH_PROVIDER = "gitlab-web-ide";
const AGENT_ACTOR = "agent:webide";

/** An approval-required tool call, waiting on the human's reply from the webview. */
interface PendingApproval {
  toolUse: ToolUseBlock;
  resolve: (ok: boolean) => void;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("werknario.openChat", () => {
      ChatPanel.createOrShow(context);
    }),
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}

class ChatPanel {
  private static current: ChatPanel | undefined;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private approvalCounter = 0;
  private busy = false;
  private conversation: Message[] = [];
  private session: AgentSession | undefined;
  /** Display name of the signed-in Web IDE user, if the auth provider gave us one. */
  private humanLabel: string | undefined;
  /** Tool calls the human has approved this run, so onToolResult knows which
   * create_merge_request/add_comment results are real actions worth auditing
   * (as opposed to a decline, which carries no isError flag either). */
  private readonly approvedToolUses = new WeakSet<ToolUseBlock>();
  /** Serializes audit.append calls: onToolResult fires without being awaited by
   * the agent loop, so without this, two appends could both read the same
   * "next seq" before either finishes hashing and collide. Chaining onto this
   * promise (rather than awaiting each call at the call site) keeps entries in
   * call order regardless of whether the caller awaits. */
  private auditTail: Promise<void> = Promise.resolve();
  /** Loaded/created once per run, from workspaceState, genesis = project path. */
  private audit: ExtensionAuditLog | undefined;

  static createOrShow(context: vscode.ExtensionContext): void {
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "werknarioChat",
      "Fleetlicht KI",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    ChatPanel.current = new ChatPanel(panel, context);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    const nonce = makeNonce();
    this.panel.webview.html = getWebviewHtml(this.panel.webview.cspSource, nonce);
    this.panel.onDidDispose(() => {
      ChatPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  private post(msg: Record<string, unknown>): void {
    void this.panel.webview.postMessage(msg);
  }

  private onMessage(m: { type?: string; [k: string]: unknown }): void {
    if (m.type === "userMessage" && typeof m.text === "string") {
      if (this.busy) return;
      void this.run(m.text);
    } else if (m.type === "approval" && typeof m.id === "string") {
      const pending = this.pendingApprovals.get(m.id);
      if (pending) {
        this.pendingApprovals.delete(m.id);
        const approved = m.approved === true;
        if (approved) this.approvedToolUses.add(pending.toolUse);
        this.recordAudit(this.humanActor(), approved ? "approve" : "decline", {
          tool: pending.toolUse.name,
        });
        pending.resolve(approved);
      }
    }
  }

  private requestApproval(toolUse: ToolUseBlock): Promise<boolean> {
    this.approvalCounter += 1;
    const id = `approval_${this.approvalCounter}`;
    this.post({
      type: "approvalRequest",
      id,
      tool: toolUse.name,
      summary: approvalSummary(toolUse),
    });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(id, { toolUse, resolve });
    });
  }

  /** "human:<display name>" if the Web IDE auth session gave us one, else "human:you". */
  private humanActor(): string {
    return `human:${this.humanLabel ?? "you"}`;
  }

  /**
   * Queue one audit entry. Chains onto auditTail instead of appending directly,
   * so entries stay in call order even when the caller (onToolResult) does not
   * await this. No-ops before a session/audit log exists — nothing to bind the
   * genesis hash to yet, and there is nothing worth auditing before that point.
   */
  private recordAudit(
    actor: string,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const audit = this.audit;
    if (!audit) return this.auditTail;
    // The chain link always resolves (errors are logged, not thrown), so one
    // failed append can never wedge every later entry in the run behind it.
    this.auditTail = this.auditTail.then(async () => {
      try {
        await audit.append(actor, action, detail);
      } catch (e) {
        console.error("werknario: audit append failed", e);
      }
    });
    return this.auditTail;
  }

  /** Build the GitLab client, backend, executor and caller once, then reuse them
   * (and their staged-edit state) for every message in this panel. */
  private async ensureSession(): Promise<AgentSession> {
    if (this.session) return this.session;
    const config = this.loadConfig();
    const token = await this.resolveToken(config);
    const client = new GitlabClient({
      baseUrl: config.gitlabBaseUrl,
      token,
      projectId: config.projectId,
    });
    const project = await client.getProject();
    const backend = new VSCodeBackend(
      createWorkspaceFs(),
      client,
      project.default_branch,
    );
    this.session = {
      executeTool: createToolExecutor(backend, {
        onApprovalRequest: (tu) => this.requestApproval(tu),
      }),
      callLlm: createProxyCaller({ url: config.proxyUrl, token: config.proxyToken }),
      system: buildSystemPrompt({
        projectPath: project.path_with_namespace,
        defaultBranch: project.default_branch,
      }),
      projectPath: project.path_with_namespace,
    };
    return this.session;
  }

  private async run(userText: string): Promise<void> {
    this.busy = true;
    this.post({ type: "status", text: "Verbinde…" });
    try {
      const session = await this.ensureSession();
      // Create/load the chain for this project, then record the task as the
      // first entry of this run. Kept behind ensureSession so a config error
      // never produces a genesis-less log — nothing is recorded before the
      // project (and so the chain's genesis) is actually known.
      this.audit = ExtensionAuditLog.load(this.context.workspaceState, session.projectPath);
      const audit = this.audit;
      this.conversation.push({ role: "user", content: userText });
      this.recordAudit(this.humanActor(), "task", { task: userText });

      this.post({ type: "status", text: "Die KI denkt nach…" });
      const result = await runAgentLoop(this.conversation, {
        system: session.system,
        tools: TOOL_DEFINITIONS,
        callLlm: session.callLlm,
        executeTool: session.executeTool,
        events: {
          onAssistantText: (text) => this.post({ type: "assistantText", text }),
          onToolUse: (b) => this.post({ type: "toolUse", label: toolUseLabel(b) }),
          onToolResult: (b, toolResult) => {
            this.post({ type: "toolResult", label: toolUseLabel(b) });
            // Only a genuine, approved, successful create_merge_request or
            // add_comment is an audited agent action — a decline carries no
            // isError flag either, so approvedToolUses (set from the human's
            // actual "approve" reply) is what tells the two apart.
            if (!toolResult.isError && this.approvedToolUses.has(b)) {
              this.approvedToolUses.delete(b);
              this.recordAudit(AGENT_ACTOR, b.name, toolAuditDetail(b));
            }
          },
          onTurn: (n) => this.post({ type: "status", text: `Runde ${n}…` }),
          // Sichtbarer Token-Zähler: der Nutzer soll sehen, wie viel schon
          // verbraucht wurde. Kosten nur, wenn das Modell in der Registry steht.
          onUsage: (_usage, totals) =>
            this.post({
              type: "status",
              text:
                `Verbraucht: ${(totals.inputTokens + totals.outputTokens).toLocaleString("de-DE")} Token` +
                (totals.costUsd > 0 ? ` (~${totals.costUsd.toFixed(2)} $)` : ""),
            }),
        },
      });
      // Persist the full transcript so the next message continues this conversation.
      this.conversation = result.messages;
      if (result.stopped === "max_turns") {
        this.post({
          type: "error",
          text: "Die KI hat das Rundenlimit erreicht und aufgehört.",
        });
      } else if (result.stopped === "no_progress") {
        this.post({
          type: "error",
          text: "Die KI ist beim selben Fehler hängen geblieben und hat aufgehört. Bitte die letzte Meldung prüfen.",
        });
      }
      await this.recordAudit(AGENT_ACTOR, "run_finished", {
        stopped: result.stopped,
        calls: result.usage.calls,
        tokens: result.usage.inputTokens + result.usage.outputTokens,
        costUsd: Number(result.usage.costUsd.toFixed(6)),
      });
      const v = await audit.verify();
      this.post({
        type: "status",
        text: `Audit: ${audit.entries().length} Einträge — Kette ${v.ok ? "geprüft" : "GEBROCHEN"}.`,
      });
    } catch (e) {
      this.post({ type: "error", text: errorText(e) });
    } finally {
      this.busy = false;
      this.post({ type: "done" });
    }
  }

  private loadConfig(): AgentConfig {
    const cfg = vscode.workspace.getConfiguration("werknario");
    const raw: Record<string, unknown> = {
      proxyUrl: cfg.get("proxyUrl"),
      proxyToken: cfg.get("proxyToken"),
      gitlabBaseUrl: cfg.get("gitlabBaseUrl"),
      projectId: cfg.get("projectId"),
      gitlabPat: cfg.get("gitlabPat"),
    };
    const { config, error } = readConfig(raw);
    if (error || !config) throw new Error(error ?? "Konfiguration ungültig.");
    return config;
  }

  private async resolveToken(config: AgentConfig): Promise<string> {
    const resolved = await resolveGitlabToken(async () => {
      const session = await vscode.authentication.getSession(
        WEB_IDE_AUTH_PROVIDER,
        ["api"],
        { createIfNone: true },
      );
      // Remember the signed-in user's display name for the audit trail's
      // human actor id. Best-effort: absent auth session just falls back to
      // "you" in humanActor(), same as an absent GitLab PAT falls back below.
      this.humanLabel = session?.account.label;
      return session?.accessToken;
    }, config.gitlabPat);
    return resolved.token;
  }
}

function createWorkspaceFs(): WorkspaceFs {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("Kein geöffnetes Projekt in der Web IDE gefunden.");
  }
  const root = folders[0]!.uri;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const toUri = (p: string): vscode.Uri => {
    // Defense in depth: the executor already rejects escaping paths, but guard
    // here too so no future caller can walk out of the project root.
    assertSafeRepoPath(p);
    const parts = p.split("/").filter((s) => s.length > 0);
    return parts.length ? vscode.Uri.joinPath(root, ...parts) : root;
  };
  return {
    async readFile(p) {
      return dec.decode(await vscode.workspace.fs.readFile(toUri(p)));
    },
    async writeFile(p, content) {
      const uri = toUri(p);
      const dir = uri.with({ path: uri.path.replace(/\/[^/]*$/, "") });
      try {
        await vscode.workspace.fs.createDirectory(dir);
      } catch {
        /* directory may already exist */
      }
      await vscode.workspace.fs.writeFile(uri, enc.encode(content));
    },
    async readDirectory(p) {
      const entries = await vscode.workspace.fs.readDirectory(toUri(p));
      return entries.map(([name, kind]) => ({
        name,
        isDir: kind === vscode.FileType.Directory,
      }));
    },
    async exists(p) {
      try {
        await vscode.workspace.fs.stat(toUri(p));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function toolUseLabel(b: ToolUseBlock): string {
  const input = b.input ?? {};
  const path = typeof input["path"] === "string" ? (input["path"] as string) : "";
  switch (b.name) {
    case "read_file":
      return `Lese ${path}`;
    case "list_files":
      return `Sehe nach in ${path || "/"}`;
    case "propose_edit":
      return `Entwurf für ${path}`;
    case "create_merge_request":
      return `Merge Request: ${String(input["title"] ?? "")}`;
    case "add_comment":
      return `Kommentar auf #${String(input["iid"] ?? "")}`;
    default:
      return b.name;
  }
}

function approvalSummary(b: ToolUseBlock): string {
  const input = b.input ?? {};
  if (b.name === "create_merge_request") {
    return `Merge Request öffnen: "${String(input["title"] ?? "")}" auf Branch ${String(
      input["source_branch"] ?? "",
    )}. Genehmigen?`;
  }
  if (b.name === "add_comment") {
    return `Kommentar auf ${String(input["target_type"] ?? "")} #${String(
      input["iid"] ?? "",
    )} posten?\n\n"${String(input["body"] ?? "")}"`;
  }
  return `"${b.name}" ausführen?`;
}

/** Structured audit detail for a completed create_merge_request/add_comment call. */
function toolAuditDetail(b: ToolUseBlock): Record<string, unknown> {
  const input = b.input ?? {};
  if (b.name === "create_merge_request") {
    return {
      title: String(input["title"] ?? ""),
      sourceBranch: String(input["source_branch"] ?? ""),
    };
  }
  if (b.name === "add_comment") {
    return {
      targetType: String(input["target_type"] ?? ""),
      iid: input["iid"],
    };
  }
  return {};
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 53 + 7) % 256;
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

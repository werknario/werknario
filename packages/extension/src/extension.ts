import * as vscode from "vscode";
import {
  buildSystemPrompt,
  createToolExecutor,
  runAgentLoop,
  TOOL_DEFINITIONS,
  type Message,
  type ToolUseBlock,
} from "@werknario/shared";
import { GitlabClient } from "@werknario/gitlab-client";
import { resolveGitlabToken } from "./auth.js";
import { readConfig, type AgentConfig } from "./config.js";
import { createProxyCaller } from "./proxyClient.js";
import { getWebviewHtml } from "./webview.js";
import { VSCodeBackend, type WorkspaceFs } from "./vscodeBackend.js";

const WEB_IDE_AUTH_PROVIDER = "gitlab-web-ide";

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
  private readonly pendingApprovals = new Map<string, (ok: boolean) => void>();
  private approvalCounter = 0;
  private busy = false;

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
      const resolve = this.pendingApprovals.get(m.id);
      if (resolve) {
        this.pendingApprovals.delete(m.id);
        resolve(m.approved === true);
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
      this.pendingApprovals.set(id, resolve);
    });
  }

  private async run(userText: string): Promise<void> {
    this.busy = true;
    this.post({ type: "status", text: "Verbinde…" });
    try {
      const config = this.loadConfig();
      const token = await this.resolveToken(config);

      const client = new GitlabClient({
        baseUrl: config.gitlabBaseUrl,
        token,
        projectId: config.projectId,
      });
      const project = await client.getProject();
      const ref = project.default_branch;

      const fs = createWorkspaceFs();
      const backend = new VSCodeBackend(fs, client, ref);
      const executeTool = createToolExecutor(backend, {
        onApprovalRequest: (tu) => this.requestApproval(tu),
      });
      const callLlm = createProxyCaller({
        url: config.proxyUrl,
        token: config.proxyToken,
      });

      const system = buildSystemPrompt({
        projectPath: project.path_with_namespace,
        defaultBranch: ref,
      });
      const messages: Message[] = [{ role: "user", content: userText }];

      this.post({ type: "status", text: "Die KI denkt nach…" });
      const result = await runAgentLoop(messages, {
        system,
        tools: TOOL_DEFINITIONS,
        callLlm,
        executeTool,
        events: {
          onAssistantText: (text) => this.post({ type: "assistantText", text }),
          onToolUse: (b) => this.post({ type: "toolUse", label: toolUseLabel(b) }),
          onToolResult: (b) =>
            this.post({ type: "toolResult", label: toolUseLabel(b) }),
          onTurn: (n) => this.post({ type: "status", text: `Runde ${n}…` }),
        },
      });
      if (result.stopped === "max_turns") {
        this.post({
          type: "error",
          text: "Die KI hat das Rundenlimit erreicht und aufgehört.",
        });
      }
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

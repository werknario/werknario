/**
 * The chat panel markup. Kept as a pure function so it has no dependency on the
 * extension host and can be inspected in a test. The webview talks to the
 * extension over postMessage:
 *   webview → extension: { type: "userMessage", text } | { type: "approval", id, approved }
 *   extension → webview: { type: "assistantText"|"toolUse"|"toolResult"|"status"|"error"|"done", ... }
 *                        | { type: "approvalRequest", id, tool, summary }
 */
export function getWebviewHtml(cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground);
    margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
  header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; }
  #log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .msg { padding: 8px 10px; border-radius: 6px; max-width: 90%; white-space: pre-wrap; word-wrap: break-word; }
  .user { align-self: flex-end; background: var(--vscode-input-background); }
  .assistant { align-self: flex-start; background: var(--vscode-editorWidget-background); }
  .tool { align-self: flex-start; font-size: 12px; opacity: 0.8; font-style: italic; }
  .error { align-self: flex-start; color: var(--vscode-errorForeground); }
  .approval { align-self: stretch; background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 10px; border-radius: 6px; }
  .approval button { margin-right: 8px; margin-top: 8px; }
  button { font-family: inherit; padding: 4px 12px; border: none; border-radius: 4px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  footer { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border); }
  #input { flex: 1; resize: none; font-family: inherit; font-size: 13px; padding: 6px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: 4px; }
  #status { padding: 4px 12px; font-size: 12px; opacity: 0.7; min-height: 16px; }
</style>
</head>
<body>
  <header>Fleetlicht KI — schlägt vor, du genehmigst</header>
  <div id="log"></div>
  <div id="status"></div>
  <footer>
    <textarea id="input" rows="2" placeholder="Aufgabe beschreiben, z. B.: entwirf ein Split Sheet aus vertraege/session-notiz_landgang_2026-05-30.md"></textarea>
    <button id="send">Senden</button>
  </footer>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const status = document.getElementById('status');
  const send = document.getElementById('send');

  function add(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function submit() {
    if (send.disabled) return; // agent is busy; don't drop the message silently
    const text = input.value.trim();
    if (!text) return;
    add('user', text);
    input.value = '';
    send.disabled = true;
    vscode.postMessage({ type: 'userMessage', text });
  }
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.type) {
      case 'assistantText': add('assistant', m.text); break;
      case 'toolUse': add('tool', '→ ' + m.label); break;
      case 'toolResult': add('tool', '✓ ' + m.label); break;
      case 'status': status.textContent = m.text || ''; break;
      case 'error': add('error', m.text); send.disabled = false; break;
      case 'done': send.disabled = false; status.textContent = ''; break;
      case 'approvalRequest': {
        const box = document.createElement('div');
        box.className = 'approval';
        const p = document.createElement('div');
        p.textContent = m.summary;
        box.appendChild(p);
        const yes = document.createElement('button');
        yes.textContent = 'Genehmigen';
        const no = document.createElement('button');
        no.textContent = 'Ablehnen';
        no.className = 'secondary';
        yes.addEventListener('click', () => { vscode.postMessage({ type: 'approval', id: m.id, approved: true }); box.remove(); });
        no.addEventListener('click', () => { vscode.postMessage({ type: 'approval', id: m.id, approved: false }); box.remove(); });
        box.appendChild(yes); box.appendChild(no);
        log.appendChild(box); log.scrollTop = log.scrollHeight;
        break;
      }
    }
  });
</script>
</body>
</html>`;
}

import * as assert from "assert";
import * as vscode from "vscode";

// These run inside a REAL headless web extension host (Chromium) via
// @vscode/test-web — the honest "it works in the browser" proof for the
// pieces that need the actual vscode API.
suite("Fleetlicht KI web extension", () => {
  test("activates and registers the chat command", async () => {
    const ext = vscode.extensions.getExtension("xconcapps.werknario-webide-agent");
    assert.ok(ext, "extension should be found");
    await ext!.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("werknario.openChat"),
      "werknario.openChat should be registered",
    );
  });

  test("workspace.fs can write and read a file in the web host", async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, "a workspace folder should be open");
    const uri = vscode.Uri.joinPath(folders![0]!.uri, "spike-d-web.txt");
    const body = "written by the web extension host";
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
    const read = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    assert.strictEqual(read, body);
  });
});

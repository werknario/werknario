/**
 * Run a shell command as an external check before a merge (the `--verify-cmd`
 * option). A zero exit code passes; non-zero blocks the merge. This is the
 * pluggable "external deterministic check" a self-healing/verification step
 * needs — the operator points it at their own lint, tests, or a CI-status probe.
 */

import { exec } from "node:child_process";

export function verifyWithCommand(
  cmd: string,
): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ ok: true });
        return;
      }
      const out = (stderr || stdout || "").trim().slice(0, 300);
      const code = (err as { code?: number }).code;
      resolve({
        ok: false,
        detail: out || `command exited with code ${code ?? "?"}`,
      });
    });
  });
}

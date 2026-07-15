export interface AgentConfig {
  proxyUrl: string;
  proxyToken: string;
  gitlabBaseUrl: string;
  projectId: string;
  /** optional PAT fallback if the Web IDE does not hand us a session token */
  gitlabPat?: string;
}

/**
 * Validate the raw settings object (read from vscode configuration in
 * production) into a usable config, or return a human-readable German error
 * naming exactly which setting is missing. Pure, so it is unit-tested.
 */
export function readConfig(raw: Record<string, unknown>): {
  config?: AgentConfig;
  error?: string;
} {
  const str = (k: string): string =>
    typeof raw[k] === "string" ? (raw[k] as string).trim() : "";

  const proxyUrl = str("proxyUrl");
  const proxyToken = str("proxyToken");
  const gitlabBaseUrl = str("gitlabBaseUrl");
  const projectId = str("projectId");
  const gitlabPat = str("gitlabPat");

  const missing: string[] = [];
  if (!proxyUrl) missing.push("werknario.proxyUrl");
  if (!proxyToken) missing.push("werknario.proxyToken");
  if (!gitlabBaseUrl) missing.push("werknario.gitlabBaseUrl");
  if (!projectId) missing.push("werknario.projectId");

  if (missing.length) {
    return {
      error: `Es fehlen Einstellungen: ${missing.join(", ")}. Bitte in den Extension-Einstellungen eintragen.`,
    };
  }

  return {
    config: {
      proxyUrl,
      proxyToken,
      gitlabBaseUrl,
      projectId,
      ...(gitlabPat ? { gitlabPat } : {}),
    },
  };
}

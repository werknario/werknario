/**
 * Resolve a GitLab API token for the current user, verified in Spike A:
 * the Web IDE registers a `gitlab-web-ide` VS Code authentication provider that
 * hands extensions an `api`-scoped OAuth token — no PAT paste needed. If that
 * path yields nothing (e.g. Web IDE auth is off), fall back to a PAT from the
 * extension settings.
 *
 * The vscode call is injected so this is testable without the extension host.
 */
export type SessionTokenGetter = () => Promise<string | undefined>;

export interface ResolvedToken {
  token: string;
  source: "web-ide" | "pat";
}

export async function resolveGitlabToken(
  getSessionToken: SessionTokenGetter,
  fallbackPat?: string,
): Promise<ResolvedToken> {
  let sessionToken: string | undefined;
  try {
    sessionToken = await getSessionToken();
  } catch {
    sessionToken = undefined;
  }
  if (sessionToken) {
    return { token: sessionToken, source: "web-ide" };
  }
  if (fallbackPat) {
    return { token: fallbackPat, source: "pat" };
  }
  throw new Error(
    "Kein GitLab-Token. Die Web IDE hat keine Sitzung geliefert und es ist kein PAT hinterlegt. " +
      "Bitte in den Extension-Einstellungen unter werknario.gitlabPat einen Zugriffstoken eintragen.",
  );
}

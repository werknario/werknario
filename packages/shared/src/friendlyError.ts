/**
 * Translates raw backend errors (GitLab/GitHub REST responses, or any thrown
 * Error) into a short, plain-language message a non-technical user can act
 * on. The agent's users operate git through the agent without knowing git;
 * a raw "400: {message: branch already exists}" is noise to them.
 *
 * Design note: `friendlyError` never echoes the raw status/detail/message
 * back to the user — those stay in the developer log, wherever the caller
 * already logs the original error. Only the classified `code` plus a fixed,
 * reviewed sentence pair (message + hint) reach the human. This keeps PII,
 * tokens, and internal paths that might leak into a raw error body out of
 * the UI by construction.
 */

export type Locale = "en" | "de";

export interface FriendlyError {
  /** Stable machine code, safe to branch on in UI or telemetry. */
  code: string;
  /** One plain-language sentence describing what went wrong. */
  message: string;
  /** One concrete next step. */
  hint: string;
}

/**
 * What classifyError/friendlyError read. A caller normally passes a thrown
 * Error (e.g. GitlabError, which carries `.status` and `.detail` alongside
 * the inherited `.name`/`.message`), or a plain `{ status, detail }` pair
 * built by hand. Every field is optional and read defensively: an object
 * with nothing set classifies as "unknown" rather than throwing.
 *
 * `message` is included even though it is not part of the caller-facing
 * shape most call sites use, because it is the only field a generic
 * `Error` (anything that isn't a GitlabError) reliably has — classification
 * falls back to pattern-matching it when `status`/`detail` are absent.
 */
interface ErrorLike {
  status?: number;
  detail?: string;
  name?: string;
  message?: string;
}

const CODES = [
  "auth",
  "missing_key",
  "network",
  "not_found",
  "branch_exists",
  "conflict",
  "rate_limit",
  "permission",
  "server",
  "unknown",
] as const;

type Code = (typeof CODES)[number];

// HTTP status codes we assign meaning to. Used both when `.status` is set
// directly and as a fallback pattern when only `.message` text is available
// (e.g. "GitLab POST /repository/branches → 400: ..."). Restricted to this
// known set, rather than any 3-digit number, to avoid matching unrelated
// numbers that happen to appear in a message.
const KNOWN_STATUS_RE = /\b(400|401|403|404|409|429|5\d{2})\b/;

function extractStatus(text: string): number | undefined {
  const m = KNOWN_STATUS_RE.exec(text);
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
}

function classify(input: ErrorLike): Code {
  const status = input.status ?? extractStatus(`${input.detail ?? ""} ${input.message ?? ""}`);
  const text = `${input.detail ?? ""} ${input.message ?? ""} ${input.name ?? ""}`.toLowerCase();

  // A provider key that is entirely absent throws locally (no HTTP status),
  // e.g. the Anthropic SDK's "Could not resolve authentication method". That is
  // distinct from an invalid key, which the vendor answers with a 401 (auth).
  if (
    text.includes("could not resolve authentication") ||
    text.includes("apikey or authtoken") ||
    text.includes("expected either apikey")
  ) {
    return "missing_key";
  }
  // The endpoint could not be reached at all (wrong URL, service down, DNS).
  if (
    text.includes("fetch failed") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("getaddrinfo") ||
    text.includes("socket hang up") ||
    text.includes("etimedout") ||
    text.includes("network error")
  ) {
    return "network";
  }

  if (status === 429 || text.includes("rate limit")) return "rate_limit";
  if (status === 401 || text.includes("unauthorized") || text.includes("invalid token")) {
    return "auth";
  }
  if (
    status === 403 ||
    text.includes("forbidden") ||
    text.includes("insufficient scope") ||
    text.includes("permission")
  ) {
    return "permission";
  }
  if ((status === 400 || status === 409) && text.includes("branch") && text.includes("already exists")) {
    return "branch_exists";
  }
  if (
    text.includes("merge conflict") ||
    text.includes("conflict") ||
    (text.includes("mergeable_state") && text.includes("dirty"))
  ) {
    return "conflict";
  }
  if (status === 404 || text.includes("not found")) return "not_found";
  if (status !== undefined && status >= 500 && status < 600) return "server";
  return "unknown";
}

/** Classifies a raw error into a stable machine code. Never throws. */
export function classifyError(input: ErrorLike): string {
  return classify(input);
}

const MESSAGES: Record<Code, Record<Locale, { message: string; hint: string }>> = {
  auth: {
    en: {
      message: "Access to the document store was denied.",
      hint: "Check the access token; it may be missing or expired.",
    },
    de: {
      message: "Der Zugriff auf den Dokumentenspeicher wurde verweigert.",
      hint: "Den Zugriffs-Token prüfen: abgelaufen oder falsch?",
    },
  },
  missing_key: {
    en: {
      message: "No API key is set for the selected model provider.",
      hint: "Set the provider's key (for Anthropic, CLAUDE_API_TOKEN), or run offline with LLM_PROVIDER=mock.",
    },
    de: {
      message: "Für den gewählten Modell-Anbieter ist kein API-Schlüssel gesetzt.",
      hint: "Den Schlüssel des Anbieters setzen (für Anthropic CLAUDE_API_TOKEN) oder mit LLM_PROVIDER=mock offline laufen lassen.",
    },
  },
  network: {
    en: {
      message: "The model endpoint could not be reached.",
      hint: "Check the endpoint URL (for openai-compatible, LLM_OPENAI_COMPAT_BASE_URL) and that the service is running.",
    },
    de: {
      message: "Der Modell-Endpunkt war nicht erreichbar.",
      hint: "Die Endpunkt-URL prüfen (bei openai-compatible LLM_OPENAI_COMPAT_BASE_URL) und ob der Dienst läuft.",
    },
  },
  permission: {
    en: {
      message: "The connected account does not have permission for this action.",
      hint: "Ask an administrator to grant the missing rights.",
    },
    de: {
      message: "Das verbundene Konto hat für diese Aktion keine Berechtigung.",
      hint: "Eine Administratorin oder ein Administrator muss die fehlenden Rechte vergeben.",
    },
  },
  not_found: {
    en: {
      message: "The requested file or item could not be found.",
      hint: "Check whether it was renamed, moved, or deleted.",
    },
    de: {
      message: "Die angeforderte Datei oder das angeforderte Element wurde nicht gefunden.",
      hint: "Prüfen, ob es umbenannt, verschoben oder gelöscht wurde.",
    },
  },
  branch_exists: {
    en: {
      message: "A working copy with that name already exists.",
      hint: "Try again; the agent will pick a different name.",
    },
    de: {
      message: "Eine Arbeitskopie mit diesem Namen gibt es schon.",
      hint: "Einfach neu versuchen, der Agent wählt einen anderen Namen.",
    },
  },
  conflict: {
    en: {
      message: "This change collides with a newer edit and cannot be merged automatically.",
      hint: "A person needs to resolve the overlap before merging.",
    },
    de: {
      message:
        "Diese Änderung überschneidet sich mit einer neueren Bearbeitung und lässt sich nicht automatisch zusammenführen.",
      hint: "Ein Mensch muss die Überschneidung vor dem Zusammenführen auflösen.",
    },
  },
  rate_limit: {
    en: {
      message: "Too many requests were sent in a short time.",
      hint: "Wait a moment and try again.",
    },
    de: {
      message: "Es wurden zu viele Anfragen in kurzer Zeit gesendet.",
      hint: "Kurz warten und dann erneut versuchen.",
    },
  },
  server: {
    en: {
      message: "The document store had a problem on its side.",
      hint: "Try again in a moment. If it keeps happening, contact support.",
    },
    de: {
      message: "Beim Dokumentenspeicher ist ein Problem aufgetreten.",
      hint: "In Kürze erneut versuchen. Falls es wieder passiert, den Support kontaktieren.",
    },
  },
  unknown: {
    en: {
      message: "Something went wrong and the action could not be completed.",
      hint: "Try again. If it keeps happening, contact support.",
    },
    de: {
      message: "Es ist etwas schiefgelaufen, die Aktion konnte nicht abgeschlossen werden.",
      hint: "Erneut versuchen. Falls es wieder passiert, den Support kontaktieren.",
    },
  },
};

/** Classifies a raw error and returns the human-facing translation for it. */
export function friendlyError(input: ErrorLike, locale: Locale = "en"): FriendlyError {
  const code = classify(input);
  const copy = MESSAGES[code][locale];
  return { code, message: copy.message, hint: copy.hint };
}

/**
 * Zitat-Kontrakt (grounding). Das Git-Repo ist die einzige Quelle der Wahrheit;
 * der Agent darf nur behaupten, was er in einer Datei gelesen hat, und muss die
 * Stelle nennen. Diese Datei liefert die Bausteine dafür:
 *
 * - read_file gibt seinen Inhalt mit Zeilennummern zurück (withLineNumbers /
 *   formatReadResult), damit der Agent exakte Zeilenspannen zitieren kann.
 * - Der Agent belegt jede inhaltliche Aussage mit [Beleg: <pfad>:L<start>-L<ende>].
 * - Vor einem teamsichtbaren Schreibvorgang (Merge Request, Kommentar) prüft
 *   validateCitations die Belege gegen das, was in dieser Sitzung wirklich
 *   gelesen wurde. Ein Beleg auf eine ungelesene Datei oder auf nicht existente
 *   Zeilen ist erfundene Herkunft und blockt den Schreibvorgang.
 *
 * Bewusste Grenze: geprüft wird, DASS der Beleg auf real Gelesenes zeigt, nicht
 * OB die zitierte Zeile die Aussage inhaltlich stützt. Die inhaltliche Deckung
 * (Groundedness-Scoring) ist ein späterer Schritt vor der Mensch-Genehmigung.
 */

export interface Citation {
  /** Der Roh-Text des Belegs, z. B. "[Beleg: a.md:L1-L4]". */
  raw: string;
  /** Zitierter Dateipfad relativ zur Repo-Wurzel. */
  path: string;
  /** Erste zitierte Zeile (1-basiert), oder undefined bei Ganzdatei-Beleg. */
  startLine?: number;
  /** Letzte zitierte Zeile (1-basiert), oder undefined bei Ganzdatei-Beleg. */
  endLine?: number;
}

export interface GroundingProblem {
  citation: Citation;
  reason: string;
}

export interface GroundingResult {
  citations: Citation[];
  problems: GroundingProblem[];
}

/** Stellt jeder Zeile "L<n>: " voran (1-basiert). Leere Zeilen bleiben erhalten. */
export function withLineNumbers(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `L${i + 1}: ${line}`)
    .join("\n");
}

/** Zeilenanzahl eines Textes, so wie der Agent ihn sieht. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

/**
 * Die read_file-Ausgabe: Kopfzeile mit Pfad und Zeilenzahl, darunter der Inhalt
 * mit Zeilennummern. Der Kopf sagt dem Agenten, worauf er sich beim Belegen
 * bezieht.
 */
export function formatReadResult(path: string, text: string): string {
  const n = countLines(text);
  return `Datei ${path} (${n} Zeilen). Belege im Format [Beleg: ${path}:L<start>-L<ende>].\n${withLineNumbers(text)}`;
}

// [Beleg: pfad]  |  [Beleg: pfad:L12]  |  [Beleg: pfad:L4-L9]
const CITATION_RE =
  /\[Beleg:\s*([^\]\s:]+)(?::L(\d+)(?:-L(\d+))?)?\s*\]/g;

/** Liest alle Belege aus einem Text. Reihenfolge = Auftreten im Text. */
export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const path = m[1];
    if (path === undefined) continue;
    const start = m[2] !== undefined ? Number(m[2]) : undefined;
    const end = m[3] !== undefined ? Number(m[3]) : start;
    out.push({ raw: m[0] ?? "", path, startLine: start, endLine: end });
  }
  return out;
}

/**
 * Merkt sich, welche Dateien in dieser Sitzung gelesen wurden und mit welchem
 * Inhalt der Agent sie gesehen hat. Der Inhalt wird gebraucht, um zu prüfen, ob
 * eine belegte Zahl in der belegten Zeile wirklich vorkommt (checkNumberGrounding).
 * Lebensdauer = eine Konversation, wie der Backend. Kein globaler Zustand.
 */
export class ReadLedger {
  private readonly lines = new Map<string, string[]>();

  /** Hält den (ggf. gekürzten) Text fest, den der Agent von `path` gesehen hat. */
  record(path: string, text: string): void {
    this.lines.set(path, text.split("\n"));
  }

  /** Zeilenzahl der zuletzt gelesenen Fassung, oder undefined wenn nie gelesen. */
  lineCountOf(path: string): number | undefined {
    return this.lines.get(path)?.length;
  }

  /** Text der Zeilen `startLine`..`endLine` (1-basiert, inklusive), oder undefined. */
  spanText(path: string, startLine: number, endLine: number): string | undefined {
    const lines = this.lines.get(path);
    if (!lines) return undefined;
    return lines.slice(startLine - 1, endLine).join("\n");
  }

  readPaths(): string[] {
    return [...this.lines.keys()];
  }
}

/**
 * Prüft die Belege eines Textes gegen das Gelesene. Ein Problem entsteht, wenn
 * ein Beleg auf eine nie gelesene Datei zeigt, auf Zeilen jenseits der
 * gelesenen Länge, oder auf eine verkehrt herum notierte Spanne.
 */
export function validateCitations(
  text: string,
  ledger: ReadLedger,
): GroundingResult {
  const citations = parseCitations(text);
  const problems: GroundingProblem[] = [];

  for (const c of citations) {
    const lineCount = ledger.lineCountOf(c.path);
    if (lineCount === undefined) {
      problems.push({
        citation: c,
        reason: `Beleg zeigt auf ${c.path}, aber diese Datei wurde in dieser Sitzung nie gelesen.`,
      });
      continue;
    }
    if (c.startLine !== undefined && c.endLine !== undefined) {
      if (c.startLine > c.endLine) {
        problems.push({
          citation: c,
          reason: `Beleg ${c.raw}: Zeilenspanne ist verkehrt herum (${c.startLine} > ${c.endLine}).`,
        });
        continue;
      }
      if (c.startLine < 1 || c.endLine > lineCount) {
        problems.push({
          citation: c,
          reason: `Beleg ${c.raw}, aber ${c.path} hat nur ${lineCount} Zeilen.`,
        });
        continue;
      }
    }
  }

  return { citations, problems };
}

/** Menschlich lesbare Sammelmeldung der Belegprobleme, für den Agenten. */
export function describeProblems(problems: GroundingProblem[]): string {
  return problems.map((p) => `- ${p.reason}`).join("\n");
}

export interface NumberWarning {
  /** Der Roh-Beleg, in dessen Zeile die Zahl fehlt. */
  raw: string;
  path: string;
  /** Die Zahl aus dem belegten Satz, die in der belegten Zeile nicht vorkommt. */
  number: string;
}

// Zahlen inkl. deutscher Schreibweise: 12, 12,5, 1.234, 1.234,56. Trennzeichen
// am Rand werden abgeschnitten, damit "Zeile 2." als "2" gilt.
const NUMBER_RE = /\d[\d.,]*/g;

function extractNumbers(claim: string): string[] {
  const out: string[] = [];
  for (const m of claim.matchAll(NUMBER_RE)) {
    const n = m[0].replace(/[.,]+$/, "");
    if (n.length > 0) out.push(n);
  }
  return out;
}

/**
 * Inhaltliche Deckung, deterministisch und beratend: jede Zahl in einem belegten
 * Satz sollte in der belegten Zeile vorkommen. Tut sie es nicht, ist das ein
 * Hinweis für den menschlichen Prüfer, kein Block: die Zahl kann falsch sein,
 * oder berechnet bzw. aggregiert (eine Summe steht nicht wörtlich in der Quelle).
 *
 * Der "belegte Satz" ist der Text vom vorherigen Beleg (oder Anfang) bis zu
 * diesem Beleg. Belege auf ungelesene Dateien oder kaputte Spannen werden
 * übersprungen, die fängt bereits validateCitations als harten Block.
 */
export function checkNumberGrounding(
  text: string,
  ledger: ReadLedger,
): NumberWarning[] {
  const warnings: NumberWarning[] = [];
  let cursor = 0;

  for (const m of text.matchAll(CITATION_RE)) {
    const raw = m[0] ?? "";
    const idx = m.index ?? 0;
    const claim = text.slice(cursor, idx);
    cursor = idx + raw.length;

    const path = m[1];
    if (path === undefined) continue;
    const lineCount = ledger.lineCountOf(path);
    if (lineCount === undefined) continue;

    const start = m[2] !== undefined ? Number(m[2]) : 1;
    const end = m[3] !== undefined ? Number(m[3]) : m[2] !== undefined ? Number(m[2]) : lineCount;
    if (start < 1 || end > lineCount || start > end) continue;

    const span = ledger.spanText(path, start, end) ?? "";
    for (const number of extractNumbers(claim)) {
      if (!span.includes(number)) {
        warnings.push({ raw, path, number });
      }
    }
  }

  return warnings;
}

/** Menschlich lesbarer Hinweis auf ungedeckte Zahlen, für den Prüfer. */
export function describeNumberWarnings(warnings: NumberWarning[]): string {
  const lines = warnings.map((w) => `- ${w.number} (${w.raw})`);
  return `Hinweis für die Prüfung: diese Zahlen im belegten Text stehen nicht in der belegten Zeile. Bitte prüfen, ob sie falsch sind oder berechnet/aggregiert:\n${lines.join("\n")}`;
}

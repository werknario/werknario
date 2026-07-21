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
 * Merkt sich, welche Dateien in dieser Sitzung gelesen wurden und wie viele
 * Zeilen der Agent jeweils gesehen hat. Lebensdauer = eine Konversation, wie der
 * Backend. Kein globaler Zustand.
 */
export class ReadLedger {
  private readonly counts = new Map<string, number>();

  /** Hält fest, dass `path` mit `lineCount` sichtbaren Zeilen gelesen wurde. */
  record(path: string, lineCount: number): void {
    this.counts.set(path, lineCount);
  }

  /** Zeilenzahl der zuletzt gelesenen Fassung, oder undefined wenn nie gelesen. */
  lineCountOf(path: string): number | undefined {
    return this.counts.get(path);
  }

  readPaths(): string[] {
    return [...this.counts.keys()];
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

/**
 * Repo-Retrieval: die zweite Hälfte des Grounding-Strangs. Der Zitatzwang
 * (grounding.ts) verlangt, dass der Agent belegt, wo ein Fakt steht. Damit er
 * das findet, ohne Pfade zu raten, sucht search_substrate den Begriff über die
 * Dateien und liefert Pfad, Zeile und Ausschnitt zurück.
 *
 * Bewusst simpel und portabel: ein rekursiver Lauf über listFiles/readFile, der
 * für beide Backends (GitLab-REST und VS-Code-Workspace) ohne Änderung
 * funktioniert. Für die kleinen bis mittleren Substrate, auf die werknario
 * zuerst zielt, reicht das; eine Suchmaschine kommt erst, wenn ein Korpus es
 * belegt erzwingt (siehe Retrieval-Entscheidung im werknario-Repo).
 *
 * Ein Suchtreffer ist Fund, kein Beleg: der Agent liest die Datei danach mit
 * read_file (das zeichnet sie fürs Belegen auf) und zitiert erst dann. So sieht
 * er den Kontext, statt eine Zeile aus dem Zusammenhang zu zitieren.
 */

export interface SearchFs {
  /** Einträge direkt unter `path`. Ordner enden auf "/". */
  listFiles(path: string): Promise<string[]>;
  /** Voller Text einer Datei. */
  readFile(path: string): Promise<string>;
}

export interface SearchHit {
  path: string;
  /** 1-basierte Zeilennummer. */
  line: number;
  /** Die Fundzeile, getrimmt und auf eine Höchstlänge gekürzt. */
  text: string;
}

export interface SearchResult {
  hits: SearchHit[];
  filesScanned: number;
  /** true, wenn eine Grenze (Treffer, Dateien) erreicht wurde und mehr existieren könnte. */
  truncated: boolean;
}

export interface SearchOptions {
  maxHits?: number;
  maxFiles?: number;
  maxLineLength?: number;
}

const DEFAULT_MAX_HITS = 40;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_LINE_LENGTH = 300;

function trimLine(line: string, max: number): string {
  const t = line.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Durchsucht das Substrat ab `startPath` (leer = Wurzel) nach `query`
 * (Teilstring, Groß-/Kleinschreibung egal). Rekursiert in Ordner (Einträge mit
 * "/" am Ende), überspringt binär wirkende Dateien und hält harte Grenzen ein.
 */
export async function searchSubstrate(
  fs: SearchFs,
  query: string,
  startPath = "",
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    throw new Error("Der Suchbegriff ist leer.");
  }
  const maxHits = opts.maxHits ?? DEFAULT_MAX_HITS;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxLineLength = opts.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;

  const hits: SearchHit[] = [];
  let filesScanned = 0;
  let truncated = false;

  const visitedFolders = new Set<string>();
  const queue: string[] = [startPath];

  while (queue.length > 0) {
    const folder = queue.shift() as string;
    if (visitedFolders.has(folder)) continue;
    visitedFolders.add(folder);

    const entries = await fs.listFiles(folder);
    for (const entry of entries) {
      if (hits.length >= maxHits || filesScanned >= maxFiles) {
        truncated = true;
        return { hits, filesScanned, truncated };
      }
      if (entry.endsWith("/")) {
        const sub = entry.replace(/\/+$/, "");
        // Nur echt tiefer absteigen, nie auf sich selbst oder nach oben.
        if (sub && sub !== folder && !visitedFolders.has(sub)) queue.push(sub);
        continue;
      }

      filesScanned += 1;
      const content = await fs.readFile(entry);
      if (content.includes("\0")) continue; // binär: nicht durchsuchen

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (line.toLowerCase().includes(needle)) {
          hits.push({ path: entry, line: i + 1, text: trimLine(line, maxLineLength) });
          if (hits.length >= maxHits) {
            truncated = true;
            return { hits, filesScanned, truncated };
          }
        }
      }
    }
  }

  return { hits, filesScanned, truncated };
}

/** Formatiert das Suchergebnis als Werkzeug-Ausgabe für den Agenten. */
export function formatSearchResults(query: string, result: SearchResult): string {
  if (result.hits.length === 0) {
    return `Kein Treffer für "${query}" (${result.filesScanned} Dateien durchsucht).`;
  }
  const lines = result.hits.map((h) => `${h.path}:L${h.line}: ${h.text}`);
  const head = `${result.hits.length} Treffer für "${query}"${result.truncated ? " (gekürzt, es gibt mehr)" : ""}:`;
  const foot =
    "Zum Belegen lies die Datei zuerst mit read_file — ein Suchtreffer ist ein Fund, noch kein Beleg.";
  return `${head}\n${lines.join("\n")}\n${foot}`;
}

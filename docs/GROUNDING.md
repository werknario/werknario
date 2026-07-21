# Zitat-Kontrakt (Grounding)

Erster Baustein des Grounding-Strangs. Adressiert die Halluzinationssorge an der Wurzel: das
Git-Repo ist die einzige Quelle der Wahrheit, und der Agent darf nur behaupten, was er dort gelesen
hat, mit Angabe der Stelle. Hintergrund und Marktbeleg stehen in
`werknario/docs/audit/2026-07-21-befund-markt-und-produkt.md` (Abschnitt 4) und in der
Retrieval-Entscheidung `werknario/docs/decisions/2026-07-21-retrieval-schicht-lightrag-vs-plain.md`.

Der Strang hat zwei Hälften: **Repo-Retrieval** (der Agent findet, wo ein Fakt steht) und
**Zitatzwang** (der Agent belegt es und darf nur belegen, was er gelesen hat). Beide sind gebaut.

## Was der Kontrakt tut

1. **Finden.** `search_files` sucht einen Begriff (Teilstring, Groß-/Kleinschreibung egal) über die
   Dateien und liefert `pfad:zeile: ausschnitt` zurück. Ein Treffer ist ein Fund, kein Beleg: der
   Agent liest die Datei danach mit `read_file` und zitiert erst dann. So sieht er den Kontext, statt
   eine Zeile aus dem Zusammenhang zu zitieren. Die Suche zeichnet nichts fürs Belegen auf. Sie läuft
   portabel über `listFiles`/`readFile`, also ohne Suchmaschine; für die kleinen bis mittleren
   Substrate reicht das (Begründung in der Retrieval-Entscheidung im werknario-Repo).
2. **Lesen mit Zeilennummern.** `read_file` gibt seinen Inhalt mit Zeilennummern zurück (`L1: …`,
   `L2: …`), plus eine Kopfzeile mit Pfad und Zeilenzahl. Der Agent hat damit stabile Koordinaten,
   auf die er sich beziehen kann.
2. **Belegen.** Jede inhaltliche Aussage über das Substrat belegt der Agent im Format
   `[Beleg: <pfad>:L<start>-L<ende>]` (auch `:L<zeile>` für eine Zeile oder ohne Zeilenangabe für die
   ganze Datei). Der System-Prompt und die Tool-Beschreibungen fordern das ein.
3. **Prüfen vor dem Schreiben.** Bevor ein teamsichtbarer Schreibvorgang läuft (`create_merge_request`,
   `add_comment`), prüft der Executor die Belege im Text gegen ein Ledger dessen, was in dieser
   Sitzung wirklich gelesen wurde. Ein Beleg auf eine nie gelesene Datei oder auf Zeilen jenseits der
   gelesenen Länge blockt den Vorgang, mit einer korrigierbaren Meldung an den Agenten. Die Prüfung
   läuft vor der Mensch-Genehmigung, damit ein erfundener Beleg gar nicht erst vorgelegt wird.

## Bewusste Grenze

Geprüft wird, **dass** ein Beleg auf real Gelesenes zeigt, nicht **ob** die zitierte Zeile die
Aussage inhaltlich stützt. Der Fall „Agent zitiert eine echte Zeile, die die Behauptung aber nicht
belegt" bleibt offen. Das ist der nächste Schritt: ein Groundedness-Gate, das die Behauptung gegen
den zitierten Inhalt prüft (LLM-Judge), bevor der Mensch genehmigt. Siehe Fahrplan P0/P1 im
werknario-Repo.

Ebenfalls noch offen: der Commit-SHA im Beleg. Aktuell prüft der Kontrakt Pfad und Zeilenspanne. Der
SHA kommt hinzu, sobald das Backend beim Lesen den Commit mitliefert, an dem gelesen wurde. Damit
wäre ein Beleg auch über die Zeit stabil („Zeile 12 zum Zeitpunkt SHA abc").

## Wo der Code liegt

- `packages/shared/src/grounding.ts` — die reine Logik: Zeilennummerierung, Beleg-Parser, Ledger,
  Prüfung. Ohne Seiteneffekte, voll unit-getestet (`test/grounding.test.ts`).
- `packages/shared/src/executor.ts` — Verdrahtung: Ledger pro Konversation, `read_file` zeichnet auf
  und nummeriert, `create_merge_request`/`add_comment` prüfen vor Genehmigung und Backend
  (`test/executor.test.ts`).
- `packages/shared/src/prompt.ts`, `tools.ts` — der Zitatzwang im System-Prompt und in den
  Tool-Beschreibungen.

## Belegsyntax

| Form | Bedeutung |
|---|---|
| `[Beleg: vertraege/split.md:L4-L9]` | Zeilen 4 bis 9 der Datei |
| `[Beleg: katalog/x.csv:L12]` | Zeile 12 |
| `[Beleg: vertraege/split.md]` | die ganze Datei (schwächster Beleg) |

Ein Beleg gilt nur, wenn die Datei in derselben Sitzung mit `read_file` gelesen wurde und die
Zeilenspanne innerhalb der gelesenen Länge liegt.

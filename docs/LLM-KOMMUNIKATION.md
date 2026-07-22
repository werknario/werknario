# LLM-Kommunikationsschicht

Wie der Agent mit dem Modell spricht: welches Modell er nimmt, wie viel er dabei
verbraucht, und wie er nicht auf einen Anbieter festgelegt ist. Alles
deterministisch, self-hostbar, ohne Drittanbieter-Dienst. Die Entscheidung dahinter
und die Belege stehen im werknario-Repo unter
`docs/decisions/2026-07-22-llm-kommunikationsschicht.md` und
`docs/research/2026-07-22-*.md`.

## Vier Bausteine

### 1. Modell-Registry (`packages/shared/src/models.ts`)

werknario ist nicht auf Claude festgelegt. Jedes einsetzbare Modell ist ein Eintrag
mit Anbieter, Preis, Kontextfenster, Tool-Use-Fähigkeit und Datenresidenz. Ein
weiteres Modell (Kimi, Mistral, ein selbst gehostetes) ist ein Eintrag hier, kein
Umbau am Agenten. Das Feld `dataResidency` (`eu` / `self-host` / `non-eu`) trägt die
DSGVO-Einordnung direkt am Modell.

Aktuell belegt: die Anthropic-Modelle (Haiku 4.5, Sonnet 5, Opus 4.8, Fable 5) mit an
platform.claude.com verifizierten Preisen, Stand 2026-07-22. Preise ändern sich
(`verifiedOn`-Feld); Sonnet 5 verlässt am 2026-09-01 den Einführungspreis.

### 2. Token-Konto (`packages/shared/src/tokens.ts`)

Der Agent verwarf bisher jedes Nutzungssignal der API. Jetzt läuft ein einfaches,
reines Konto: `TokenLedger.record(usage, model)` nach jeder Antwort, `totals()` liefert
Token und Kosten. Die Kosten kommen aus der Registry, gewichtet nach den verifizierten
Preisen (Output zählt mehr als Input, ein Cache-Read fast nichts). Ein unbekanntes
Modell wird nicht erfunden: `costUsd` bleibt 0 und `unpricedCalls` zählt hoch, damit
die Lücke sichtbar ist.

`estimateCostUsd(usage, model, { bedrockEu })` rechnet einen Einzelaufruf; der
Bedrock-EU-Regional-Aufschlag (+10 %) kommt als Flag dazu, weil er vom Endpunkt
abhängt, nicht vom Modell.

Optional ein Budget: `new TokenLedger({ budget: { maxUsd, warnAtRatio } })`. `status()`
meldet `ok` / `warn` / `over`. Der Zähler blockt nichts von sich aus — das ist Sache
des Loops (siehe Budget-Gate).

### 3. Modell-Router (`packages/shared/src/routing.ts`)

Deterministisch, regel-basiert, kein zusätzlicher Klassifikator-Aufruf. `selectTier`
bildet Signale (welches Tool, welche Pfade, bisherige Kosten) auf eine Stufe ab:
reine Lesevorgänge sind billig (Haiku), Vorschläge Standard (Sonnet), sensible Pfade
(`vertraege/`, `verwaltung/`) oder Mehrfach-Änderungen hoch (Opus). Eine weiche
Budget-Bremse (`softBudgetUsd`) schaltet bei Überschreitung eine Stufe herunter.

Anbieter-agnostisch: welche Modelle je Stufe genutzt werden, steht in der Policy
(`modelByTier`). Standard sind Claude-Stufen über Bedrock EU; man setzt Kimi oder
Mistral ein, indem man die Policy ändert. `validateRoutingPolicy` verweigert eine
Policy, deren Modell keine belegte EU-Datenresidenz hat (`euOnly`, Standard an) — kein
versehentlicher Datenabfluss.

### 4. Prompt Caching (Provider)

Beide Provider (`anthropic.ts`, `bedrock.ts`) setzen jetzt einen
`cache_control`-Breakpoint auf den System-Prompt. Der ist groß und über alle Turns
identisch; ein Cache-Read kostet 10 % des Input-Basispreises. Das ist der klarste
Sparhebel und war bisher ungenutzt. Der Effekt wird im Token-Konto sichtbar, weil
`cache_read_input_tokens` über die Turns wächst.

## Im Loop verdrahtet

`runAgentLoop` (`packages/shared/src/loop.ts`) führt jetzt ein Token-Konto (immer, reine
Beobachtung) und gibt `result.usage` zurück. Zwei optionale Hebel, standardmäßig aus,
ändern das heutige Verhalten nicht:

- `events.onUsage(usage, totals)` — feuert nach jeder Antwort mit laufenden Summen. Die
  Extension zeigt daraus einen Token-Zähler in der Statuszeile.
- `budgetGate(totals) => "continue" | "stop"` — geprüft an derselben Stelle wie das
  Rundenlimit. Bei `"stop"` bricht der Loop sauber ab (`stopped: "budget"`), mit gültigem
  Transkript.
- `selectModelForTurn(ctx) => modelId` — wählt das Modell pro Runde. `makeSelectModelForTurn(policy)`
  baut das aus einer Routing-Policy; `signalsFromMessages` leitet die Signale aus dem
  Verlauf ab.

## Was noch fehlt (bewusst offen)

- **Router im Betrieb einschalten** braucht die exakten Bedrock-EU-Inferenzprofil-IDs
  (kanonischer Name → volle `eu.anthropic.…-v1:0`-ID), die gegen die Bedrock-Models-API
  zu prüfen sind (AWS-Zugang nötig). Erst danach ist `selectModelForTurn` in der Extension
  sicher, sonst landet ein kanonischer Name als `anthropic.…` ohne EU-Präfix.
- **Budget-Wert** (Tages-/Sitzungslimit in USD) ist eine Betreiber-Entscheidung, kein
  Default. Bis dahin ist das Budget-Gate aus.
- **Bedrock-`usage`-Feldnamen** sind mit hoher Wahrscheinlichkeit identisch zur
  First-Party-API, aber nicht an einem echten Bedrock-Call gegengeprüft.
- **Weitere Modelle** (Kimi, Mistral, …) sind als Registry-Struktur vorbereitet; ihre
  Einträge (Preis, Datenresidenz, Tool-Use) kommen, sobald verifiziert.

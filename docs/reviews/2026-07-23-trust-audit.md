# Trust-Audit werknario-webide-agent — 2026-07-23

## Zusammenfassung: Haben wir es gebrochen?

Teilweise. Der vertrauenskritische Kern hält an fünf von sechs geprüften Dimensionen. Wir haben eine Lücke gefunden, die durchkommt: die EU-Datenresidenz lässt sich beim Provider `openai-compatible` durch eine plausible Fehlkonfiguration aushebeln, ohne dass der dafür vorgesehene Override gesetzt sein muss. Der Boot-Check meldet dann fälschlich `residency: 'eu'` und schreibt diese falsche Behauptung sogar in die manipulationsevidente Audit-Kette.

Alle anderen adversariellen Hypothesen (Vier-Augen-Prinzip, Audit-Kette, Path-Traversal, Grounding, Loop-Budget) haben die Refutations-Verifikation nicht überlebt oder erwiesen sich als dokumentierte, bewusst gezogene Grenzen. Es bleibt genau ein bestätigter Fund, Schweregrad hoch.

Das Ergebnis ist ehrlich betrachtet gut, aber nicht sauber: Der eine Fund sitzt ausgerechnet im zentralen Produktversprechen (EU-Datenresidenz für personenbezogene Repo-Inhalte). Er wurde am 2026-07-23 geschlossen (Status unter F1).

## Methode

Feindliches Trust-Audit über sechs Dimensionen. Für jede Dimension wurde erst ein Red-Team-Durchlauf gefahren (aktiv nach Bypässen gesucht), anschließend jeder Verdacht durch eine Refutations-Verifikation gegen den echten Code geführt: Ein Fund zählt nur, wenn keiner der Widerlegungspfade am tatsächlichen Code standhält. Verdachtsmomente, die sich als dokumentierte Grenze, als durch einen Default abgefangen oder als nicht reproduzierbar herausstellten, wurden verworfen.

Geprüfte Dimensionen:

1. Residenz — kommt keine Anfrage mit personenbezogenen Daten an einen non-EU-Endpunkt ohne Override?
2. Vier-Augen — kann ein nicht autorisierter Approver mergen, auch unter `--yes`?
3. Audit-Kette — bricht die Verifikation bei jeder Mutation, Löschung, Einfügung, Umsortierung?
4. Path-Traversal — entkommt kein Tool-Pfad dem Repo-Root?
5. Grounding — blockt jeder unbelegbare Zitat-Beleg hart, vor der Mensch-Genehmigung?
6. Loop-Budget — greift die Deckelung auch bei fehlenden oder unbepreisten Verbrauchsdaten?

Nach Deduplizierung (mehrere Dimensionen können dieselbe Codestelle treffen) bleibt ein bestätigter Fund. Er ist einzigartig in der Residenz-Dimension; keine Überlappung mit den anderen fünf.

## Bestätigte Funde

### F1 — openai-compatible: EU-Residenz aus dem Modellnamen abgeleitet, physische base_url nie geprüft

- Dimension: Residenz
- Schweregrad: hoch (nach Verifikation bestätigt)
- Datei: `packages/shared/src/routing.ts:180`
- Beteiligte Stellen: `routing.ts:167-188` (routeResidency), `routing.ts:197-201` (checkRunResidency-Signatur ohne base_url), `models.ts:147-161` (mistral-large-3, dataResidency 'eu'), `cli.ts:291-301` und `server.ts:12-19` (Boot-Checks reichen nur `region` durch), `cli.ts:346-351` (Audit-Eintrag), `openai-compatible.ts:15,25,39` (Endpunkt = base_url).

Invariante: Keine Anfrage mit personenbezogenen Daten erreicht einen non-eu-Endpunkt, außer der Betreiber setzt `WERKNARIO_ALLOW_NON_EU`. Für `openai-compatible` soll die Residenz aus der Registry stammen. Die Registry ordnet aber eine Modell-ID einer EU-Route zu, während die tatsächliche Route ausschließlich durch `LLM_OPENAI_COMPAT_BASE_URL` bestimmt wird.

Angriff: Der Betreiber setzt `LLM_PROVIDER=openai-compatible`, `LLM_MODEL=mistral-large-3` (Registry: `dataResidency 'eu'`) und `LLM_OPENAI_COMPAT_BASE_URL=https://openrouter.ai/api/v1` (US-Aggregator, der Mistral/Qwen/DeepSeek unter genau diesen Modellnamen ausliefert). `WERKNARIO_ALLOW_NON_EU` ist nicht gesetzt. Der Boot-Check `checkRunResidency('openai-compatible','mistral-large-3',{allowNonEu:false})` ruft `routeResidency()` auf, das `mistral-large-3` in der Registry nachschlägt (`routing.ts:181-186`), `'eu'` findet und `ok:true`, `residency:'eu'`, `overridden:false` liefert. CLI und Proxy lassen den Lauf ohne Warnung zu. Jede Runde inklusive personenbezogener Repo-Inhalte geht per `fetch()` an `openrouter.ai` in die USA. Der Residency-Audit-Eintrag protokolliert dabei fälschlich `residency:'eu'`.

Kern des Problems: `checkRunResidency` bekommt die base_url nie übergeben (Signatur nur `{region, allowNonEu}`). Für `bedrock` wird die Endpunkt-Dimension (Region) validiert und `us-east-1` blockiert (`routing.ts:172-175`) — dieselbe Klasse Fehlkonfiguration wird bei `bedrock` gefangen, bei `openai-compatible` nicht. Der Kommentar in `openai-compatible.ts:15` gibt selbst zu, dass Datenresidenz eine Frage der base_url ist, während der Guard die base_url ignoriert. Der Code widerspricht seiner eigenen Zusicherung.

Fix: Modell-ID an einen erlaubten Host binden, statt sie als Stellvertreter für die Route zu vertrauen. In `models.ts` jedem EU/self-host `openai-compatible`-Eintrag ein `euHosts`-Allowlist-Feld geben (`mistral-large-3 -> ['api.mistral.ai']`, `*-ovhcloud -> OVHcloud-Hosts`, self-host `-> localhost/RFC1918/.internal`). `checkRunResidency` und `routeResidency` um `baseUrl` erweitern; für `provider==='openai-compatible'` den Host aus der base_url gegen die Allowlist des kanonisierten Modells prüfen — kein Treffer heißt fail-safe non-eu. `server.ts:12` und `cli.ts:291` müssen `proxyConfig.openaiCompatible.baseUrl` mitgeben.

Test: `checkRunResidency('openai-compatible','mistral-large-3',{baseUrl:'https://openrouter.ai/api/v1',allowNonEu:false}).ok===false`; mit `baseUrl:'https://api.mistral.ai/v1'` -> `ok:true`, `residency:'eu'`; self-host mit `baseUrl:'http://localhost:8000/v1'` -> `ok:true`, `residency:'self-host'`; non-EU-Host mit `allowNonEu:true` -> `ok:true`, `overridden:true`.

Status: behoben am 2026-07-23. Umgesetzt wie vorgeschlagen — `euHosts`-Feld in der Registry (`mistral-large-3 -> ['api.mistral.ai']`), `baseUrl` und eine betreiber-erklärte EU-Host-Allowlist (`WERKNARIO_OPENAI_COMPAT_EU_HOSTS`) durch `checkRunResidency` und `routeResidency` gereicht, Host-Prüfung mit fail-safe non-eu, self-host nur auf privatem oder lokalem Host. Verdrahtet in `cli.ts` und `server.ts`. Sieben Regressionstests in `packages/shared/test/models.test.ts` (rot vor dem Fix, grün danach); Typecheck über alle Workspaces sauber, die Kern-Test-Suites (shared, proxy, cli, gitlab-client, github-client) mit 297 Tests grün.

## Lock-Test-Plan je Dimension

Regressionstests, die die Invarianten festnageln. Ein Teil davon schlägt heute rot fehl und pinnt genau die offene Lücke bzw. bekannte Randfälle fest; der Rest verriegelt Verhalten, das aktuell hält, gegen künftige Regression.

### Residenz (bricht ohne Fix)

- openai-compatible: EU-Modell auf non-EU-base_url wird blockiert (Regression für F1). `packages/shared/test/models.test.ts` — schlägt heute fehl und nagelt die Lücke fest.
- self-host base_url (localhost/RFC1918) bleibt erlaubt, öffentlicher Host ohne Allowlist-Treffer nicht. `packages/shared/test/models.test.ts`.
- bedrock ist strikt region-gepinnt (`us-east-1` -> fail, `eu-central-1` -> ok, undefined -> fail, führendes Leerzeichen -> fail). `packages/shared/test/models.test.ts`.
- anthropic-Direktroute ist immer non-eu, auch für EU-registriertes Modell. `packages/shared/test/models.test.ts`.
- unbekannter Provider und unbekanntes/rohes Modell fallen fail-safe auf non-eu. `packages/shared/test/models.test.ts`.
- validateRoutingPolicy meldet jede non-eu-Stufe unter euOnly. `packages/shared/test/routing.test.ts`.
- Proxy/CLI verweigern Start auf non-eu-Route ohne Override. `packages/proxy/test/server-residency.test.ts`.

### Vier-Augen (Absicherung, keine offene Lücke bestätigt)

- closeLoop blockt nicht autorisierten Approver auch unter `--yes` und auditiert `merge_denied`. `packages/cli/src/closeLoop.test.ts`.
- Autorisierter Approver darf mergen, nicht autorisierter nicht (Basis-Gate). `packages/shared/src/policy.test.ts`.
- Identität ist token-gebunden, nicht selbst-deklariert; Auth-Fehler ist fail-closed. `packages/cli/src/cli.test.ts`.
- Approver-Gate normalisiert Pfade wie canWrite. `packages/shared/src/policy.test.ts`.
- Leere Approver-Liste bedeutet deny-all, nicht allow-all. `packages/shared/src/policy.test.ts`.
- Glob-Matching ist case-sensitive und deckt sich mit dem case-sensitiven Substrat. `packages/shared/src/policy.test.ts`.
- touchedPaths ist deckungsgleich mit den committeten Dateien. `packages/cli/src/runTask.test.ts`.

Hinweis: Drei dieser Tests (token-gebundene Identität, Pfad-Normalisierung, leere Approver-Liste) sind als heute rot markiert. Sie pinnen Randfälle fest, die in der Refutation nicht zu einem eigenständigen high/critical-Fund reiften, aber als Härtung eingezogen werden sollten.

### Audit-Kette (hält)

- verify bricht bei Mutation, Löschung, Einfügung und Umsortierung mitten in der Kette, jeweils mit exaktem `brokenAt`. `packages/shared/src/audit.test.ts`.
- Golden-Vector: canonicalizeEntry und sha256 byte-/hex-stabil (CLI == Extension-Kontrakt). `packages/shared/src/audit.test.ts`.
- Tail-Truncation: verify sagt weiter ok, Anker-Abgleich schlägt fehl. `packages/cli/src/verifyCommand.test.ts`.
- Signatur: Manipulation an sig/head schlägt fehl, Entfernen fällt als checked=0 auf. `packages/shared/src/signing.test.ts`.
- Kanonisierung: numerische Sonderwerte (NaN, Infinity, -0) kollidieren nicht still mit null/0. `packages/shared/src/audit.test.ts`.
- verify-Command Exit-Code: exit 1 bei Bruch, exit 0 bei intakter Kette. `packages/cli/src/verifyCommand.test.ts`.

### Path-Traversal (hält)

- assertSafeRepoPath weist jede literale ASCII-Traversierung zurück. `packages/shared/src/executor.test.ts`.
- assertSafeRepoPath weist Null-Byte und führenden Slash getrennt zurück. `packages/shared/src/executor.test.ts`.
- Jeder pfadnehmende Tool-Case ruft den Guard vor dem Backend auf. `packages/shared/src/executor.test.ts`.
- propose_edit-Guard blockt Traversierung auch bei erlaubtem writeGuard. `packages/shared/src/executor.test.ts`.
- searchSubstrate liest niemals einen Eintrag außerhalb des Roots. `packages/shared/src/search.test.ts`.
- create_merge_request und add_comment bleiben approval-pflichtig, Reads nicht. `packages/shared/src/tools.test.ts`.
- Kodierte und Unicode-Traversierung wird abgelehnt — heute rot, dokumentiert die Grenze (siehe unten). `packages/shared/src/executor.test.ts`.

### Grounding (hält)

- Beleg auf nie gelesene Datei blockt hart. `packages/shared/test/grounding.test.ts`.
- Beleg auf Zeile jenseits der gelesenen Länge blockt. `packages/shared/test/grounding.test.ts`.
- verdrehte Spanne (start>end) blockt. `packages/shared/test/grounding.test.ts`.
- Zeile 0 / start<1 blockt. `packages/shared/test/grounding.test.ts`.
- Ganzdatei-Beleg auf gelesene Datei ok, auf ungelesene blockt. `packages/shared/test/grounding.test.ts`.
- exakte Pfad-Gleichheit erforderlich (keine Case-Aufweichung). `packages/shared/test/grounding.test.ts`.
- malformed Beleg (Leerzeichen im Pfad) wird als Beleg erkannt und blockt. `packages/shared/test/grounding.test.ts`.
- Zahl-Abdeckung ist rein beratend und blockt nie. `packages/shared/test/grounding.test.ts`.
- executor: ungültiger Beleg blockt vor der Mensch-Genehmigung. `packages/shared/test/executor.test.ts`.
- executor: Ledger nutzt den gekürzten Read-Text. `packages/shared/test/executor.test.ts`.
- executor: Zahl-Warnung blockt den MR nicht, hängt nur Hinweis an. `packages/shared/test/executor.test.ts`.
- executor: Beleg im MR-Titel wird geprüft. `packages/shared/test/executor.test.ts`.

### Loop-Budget (hält)

- budget-gate stoppt sobald costUsd das Budget erreicht (bepreistes Modell). `packages/shared/src/loop.test.ts`.
- budget-gate bleibt wirksam bei nicht-registriertem Modell. `packages/shared/src/tokens.test.ts`.
- fehlendes usage-Objekt macht Turns nicht gratis. `packages/shared/src/loop.test.ts`.
- max-turns hart erzwungen, Transcript bleibt gültig. `packages/shared/src/loop.test.ts`.
- nicht-endliches maxTurns fällt auf DEFAULT zurück. `packages/shared/src/loop.test.ts`.
- stall-limit stoppt bei identischer Fehlersignatur. `packages/shared/src/loop.test.ts`.
- friendlyError echoot niemals Rohfehler, Token oder Header. `packages/shared/src/friendlyError.test.ts`.
- Abbruch paart jeden offenen tool_use mit tool_result. `packages/shared/src/loop.test.ts`.

## Bewusst nicht als Fund gewertet (dokumentierte Grenzen)

- Kodierte und Unicode-Traversierung (`%2e%2e/x`, `‥/x` U+2024, Fullwidth-Punkte): `assertSafeRepoPath` normalisiert keine Prozent-/Unicode-Kodierungen. Das ist keine Lücke, solange die Backends niemals dekodieren, bevor sie den Pfad an das Git-Substrat geben. Der zugehörige Lock-Test ist bewusst rot gehalten, damit die Annahme "Backends dekodieren nie" entweder durch Normalisierung im Guard oder durch explizite Dokumentation abgesichert wird. Kein reproduzierbarer Escape am aktuellen Code.
- Vier-Augen-Randfälle (Pfad-Normalisierung im Approver-Gate, leere Approver-Liste, token-gebundene Identität): In der Refutation ließ sich kein durchgängiger Merge durch einen nicht autorisierten Approver herstellen, der nicht schon vom Basis-Gate abgefangen würde. Die drei rot markierten Lock-Tests sind Härtung, kein bestätigter Bypass.
- Bedrock-Region-Pinning: Hält. `us-east-1` und leere Region werden fail-safe als non-eu behandelt. Diese Dimension ist der positive Gegenbeweis zu F1 — dieselbe Fehlkonfigurationsklasse wird hier korrekt gefangen.

## Nächster Schritt

F1 ist geschlossen und mit sieben Regressionstests festgenagelt (rot vor dem Fix, grün danach). Offen als optionale Härtung bleiben die im Lock-Test-Plan als bewusst-rot markierten Fälle: kodierte/Unicode-Pfad-Traversierung (Annahme "Backends dekodieren nie" absichern oder im Guard normalisieren) und die drei Vier-Augen-Randfälle (token-gebundene Identität, Pfad-Normalisierung im Approver-Gate, leere Approver-Liste als deny-all). Keiner davon ist ein bestätigter Bypass; sie verriegeln Annahmen gegen künftige Regression.

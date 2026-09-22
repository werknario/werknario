// MOCKDATEN — fiktive Inhalte für Demo-Zwecke
#import "../_setup/label.typ": *
#show: label-doc.with(title: "Split Sheet — Werkanteile", subtitle: "„Landgang“ (Arbeitstitel) — Nachtfähre", date: "Entwurf, Stand: 16.07.2026")

= Dokument
#keyval(
  ("Kat.-Nr.", katalognr("FLT-019")),
  ("Titel", [Landgang (Arbeitstitel)]),
  ("Act", actname("Nachtfähre")),
  ("Release", [Landgang (Album, Q4/2026, in Vorbereitung)]),
  ("ISRC", [#isrc("DE-MCK-26-00191") — vorgesehen, von TÖZ noch nicht final vergeben]),
  ("GEMA-Werknr.", [#gemawn("GEMA-MOCK-100191") — vorgesehen, noch nicht angemeldet]),
  ("Status", strong("ENTWURF — Split vorgeschlagen, keine Unterschriften")),
)

= Grundlage
Dieser Entwurf leitet die Werkanteile aus der Session-Notiz vom 30.05.2026 (Studio Wilhelmsburg) ab. Die Notiz ist eine unredigierte Mitschrift und ausdrücklich nicht als Split Sheet gedacht; sie ist bislang die einzige Aufzeichnung zur Entstehung des Titels. Der Werkanteil gesamt gewichtet Musik und Text zu je 50 %.

Anwesend waren Lasse Detert und Momo Kwaśniewski, dazu ab dem Nachmittag Vince Ottkamp, angefragt als Co-Produzent für den Refrain. Ob Ottkamps Beitrag einen Autorenanteil auslöst oder über eine Producer-Fee abgegolten wird, wurde in der Session nicht besprochen. Die Label-Runde vom 04.06.2026 hat die Klärung unter Beschluss 1 an ARE übergeben, Frist 18.06.2026.

= Vorgeschlagener Split
Das Label geht mit diesem Vorschlag in die Klärung: Ottkamp erhält einen Autorenanteil. Die Werte sind der Vorschlag, nicht der Stand. Sie gelten erst, wenn alle Beteiligten gezeichnet haben.

#booktable(
  columns: (auto, auto, auto, auto, auto),
  aligns: (left, right, right, right, left),
  header: ([Beteiligte:r], [Musik %], [Text %], [Werkanteil %], [Verlag]),
  rows: (
    ([Lasse Detert #krz("Gesang, Gitarre, Topline, Text")], [45], [100], [72,5], [Fleetlicht Verlag]),
    ([Momo Kwaśniewski #krz("Synths, Produktion, Beat, Akkorde")], [45], [0], [22,5], [Fleetlicht Verlag]),
    ([Vince Ottkamp #krz("extern, Synth-Hook Refrain")], [10], [0], [5], [offen]),
    ([*Summe*], [*100*], [*100*], [*100*], []),
  ),
)

Musik-Komposition: Detert 45 %, Kwaśniewski 45 %, Ottkamp 10 %. Text vollständig bei Detert. Der Werkanteil gesamt ergibt sich rechnerisch aus (Musik + Text) / 2 je Person.

= Bewertung der Beiträge
Detert brachte Topline und Text vollständig mit, zwei Strophen und Hook. Kwaśniewski brachte Beat und Akkorde als vor der Session fertiges Grundgerüst. Beide Zuordnungen sind aus der Notiz eindeutig.

Ottkamps Synth-Hook im Refrain wird als Kompositionsbeitrag gewertet, nicht als Produktionsleistung. Begründung: Es handelt sich laut Notiz um eine neue melodische Figur, die nicht Teil des ursprünglichen Demos war, an der prominentesten Stelle des Stücks. Die ursprüngliche Anfrage an Ottkamp lautete auf Co-Produktion; der tatsächliche Beitrag geht darüber hinaus. Der Ansatz von 10 % Musik trägt dem Rechnung, ohne die Anteile der beiden Hauptautoren wesentlich zu verschieben.

Ottkamps zweiter Beitrag, eine Bridge-Idee (Break und Wiedereinstieg), ist hier nicht bewertet. Er war laut Notiz nur angespielt und nicht ausgearbeitet. Wird die Bridge später in ausgearbeiteter Form übernommen, ist der Anteil neu zu verhandeln.

= Offene Punkte
+ *Frist überschritten.* Beschluss 1 der Label-Runde vom 04.06.2026 sah die Klärung mit Ottkamp bis zum 18.06.2026 durch ARE vor. Ein Ergebnis liegt bis heute (16.07.2026) nicht vor, die Frist ist seit vier Wochen abgelaufen. Bis zur Klärung bleibt die Metadaten-Freigabe an Tidewave laut demselben Beschluss gesperrt, und der Q4-Termin für FLT-019 rückt näher.
+ *Zustimmung Ottkamp.* Der Vorschlag ist mit ihm nicht abgestimmt. Ohne seine Zeichnung ist der Split nicht final, unabhängig davon, für wie angemessen das Label ihn hält.
+ *Verlagsanteil Ottkamp.* Er ist kein Fleetlicht-Verlagsautor. Das Feld steht auf „offen“ und ist bei Zustimmung mitzuklären.
+ *Zustimmung Detert und Kwaśniewski.* Beide müssen dem Vorschlag zustimmen, bevor Unterschriften eingeholt werden. Deterts Reaktion in der Session war laut Notiz zurückhaltend.
+ *Kennungen.* ISRC und GEMA-Werknummer sind vorgesehen, aber nicht vergeben. Die Anmeldung erfolgt erst nach vollständiger Zeichnung.

= Nicht beteiligt
Ilva Brandt und Kim Sundermann (beide Nachtfähre) waren an der Session nicht beteiligt und haben nach aktuellem Stand keinen Autorenanteil an diesem Titel. Die offene Frage, ob Sundermann die Drums noch einspielt oder Kwaśniewski sie nachträglich programmiert, betrifft die Aufnahme, nicht das Werk, und ändert dieses Split Sheet nicht. Sie wird laut Protokoll von MST mit JAH nachgehalten.

= Unterschriften
#booktable(
  columns: (1fr, auto, auto),
  header: ([Beteiligte:r], [Unterschrift], [Datum]),
  rows: (
    ([Lasse Detert], [offen], [—]),
    ([Momo Kwaśniewski], [offen], [—]),
    ([Vince Ottkamp], [offen], [—]),
  ),
)

Keine Unterschriften eingeholt. Der Vorschlag ersetzt die Klärung nicht, er ist ihre Grundlage. Nächster Schritt ist das überfällige Gespräch nach Beschluss 1.

#mockfussnote

<!-- MOCKDATEN — fiktive Inhalte für Demo-Zwecke -->

# Bereinigungsplan Katalog-Stammdaten

Stand: 2026-04-08
Anlass: Tidewave hat bei der Q1-Auslieferung drei ISRCs zurückgewiesen (Format-Fehler), zusätzlich zwei doppelte Künstlerprofile bei Apple gemeldet. Siehe `metadaten-notiz.md`.
Verantwortlich für Umsetzung: TÖZ (Erfassung), Freigabe BLI (Abrechnung), JAH (A&R, Endkontrolle).

## 1. ISRC-Schreibfehler (FLT-005, Küstenlärm)

Drei Zeilen in `katalog_stammdaten.csv` haben falsch formatierte ISRCs. Alle drei liegen im selben Release, vermutlich beim Ersteintrag 2018 mit Copy-Paste aus einer Excel-Vorlage entstanden, die Unterstriche statt Bindestriche gesetzt hat.

| Titel | Aktuell (falsch) | Soll |
|---|---|---|
| Föhnfenster | `DE_MCK_18_00054` | `DE-MCK-18-00054` |
| Winterhude | `DEMCK1800056` | `DE-MCK-18-00056` |
| Nachtbus | `de-mck-18-00058` | `DE-MCK-18-00058` |

Aufgabe: TÖZ korrigiert die drei Schreibweisen direkt in `katalog_stammdaten.csv`. Nicht anfassen: die DSP-Exporte in diesem Ordner zitieren die falschen Schreibweisen teils bewusst (Tidewave-Rückweisung), die bleiben als Beleg stehen und werden nicht nachträglich korrigiert.

Frist: 2026-04-15. Nach Korrektur meldet TÖZ den Fix an RKA, damit der nächste Tidewave-Redelivery-Lauf mit den drei Titeln neu angestoßen wird.

## 2. Duplikat-Künstlerprofil Elin Sörig / Elin Soerig

FLT-007 „Neonlicht" ist in der Stammdatenzeile als Act „Elin Soerig" erfasst (ohne Umlaut, o-Transliteration statt ö). Der Rest des Katalogs (FLT-010, FLT-014) läuft korrekt unter „Elin Sörig". Auf Apple Music resultieren daraus zwei getrennte Künstlerprofile mit getrennten Play-Zahlen, sichtbar im aktuellen Apple-Export (`dsp_export_applemusic_2026-q1.csv`, zwei Zeilen für dieselbe ISRC).

Aufgabe:
1. TÖZ korrigiert den Act-Namen in `katalog_stammdaten.csv`, Zeile FLT-007, auf „Elin Sörig".
2. RKA stellt beim Apple-Music-Portal einen Profil-Merge-Antrag (Artist Profile Merge Request), unter Verweis auf beide Profil-IDs. Laufzeit laut Apple-Support-Erfahrung 2–6 Wochen, außerhalb unserer Kontrolle.
3. BLI prüft nach dem Merge, ob rückwirkend Play-Zahlen aus dem alten Profil nachgemeldet werden oder ob der Zeitraum vor dem Merge verloren ist (kommt vor).

Frist: Korrektur Stammdaten 2026-04-15, Merge-Antrag bis 2026-04-22 (RKA).

## 3. Fehlende Komponisten

Drei Werke haben eine leere `urheber`-Spalte, damit auch keine GEMA-Werknummer. Ohne Komponistenangabe keine GEMA-Anmeldung, ohne Anmeldung keine Ausschüttung: die drei Titel laufen aktuell komplett am Verlag vorbei.

| Titel | ISRC | Release |
|---|---|---|
| Tidenkalender | DE-MCK-17-00043 | FLT-004 (Wattenmeer, Marschlicht) |
| Groyne | DE-MCK-20-00093 | FLT-009 (Tidenhub, Nebenmeer) |
| Sandbank | DE-MCK-22-00133 | FLT-013 (Priel, Marschlicht) |

Aufgabe: JAH klärt mit Ove Reimers / Sanne de Vries (Marschlicht) und Til Grunwald (Nebenmeer) direkt, wer an den drei Titeln als Komponist beteiligt war. Vermutlich schlicht bei der Ersterfassung vergessen, da alle drei Instrumental-Stücke ohne Gesangsspur sind und beim Anlegen offenbar übersprungen wurden. Sobald die Namen feststehen, trägt TÖZ sie in `katalog_stammdaten.csv` nach, BLI vergibt im Anschluss die GEMA-Werknummern nach dem üblichen Schema (`GEMA-MOCK-1000NN`, fortlaufend).

Frist: Klärung mit Acts bis 2026-04-30 (JAH), Nachtrag Stammdaten + Werknummern bis 2026-05-08 (TÖZ/BLI).

## Reihenfolge

1 vor 2 vor 3. Die ISRC-Fixes sind reine Schreibarbeit und blockieren nichts, sollten aber zuerst raus, damit der nächste Tidewave-Lauf sauber ist. Der Profil-Merge (2) läuft parallel, weil er ohnehin Wartezeit bei Apple hat. Die Komponisten-Klärung (3) braucht Rückmeldung von den Acts und wird am längsten dauern.

Nächster Check-in: 2026-04-16, kurze Runde TÖZ/BLI/JAH, Stand aller drei Punkte.

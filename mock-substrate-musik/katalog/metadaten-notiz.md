<!-- MOCKDATEN — fiktive Inhalte für Demo-Zwecke -->

# Notiz — Tidewave-Rückweisung Q1

2026-04-03, TÖZ

Kurz für's Protokoll, bevor ich's vergesse: Q1-Lieferung an Tidewave ist mit drei zurückgewiesenen ISRCs zurückgekommen. Fehlermeldung im Portal nur "invalid ISRC format", keine Zeile, kein gar nichts. Musste erst alle 67 Zeilen der Stammdaten durchgehen bis ich's hatte.

Die drei:
- Föhnfenster — Unterstriche statt Bindestriche (`DE_MCK_18_00054`)
- Winterhude — komplett ohne Trennzeichen (`DEMCK1800056`)
- Nachtbus — kleingeschrieben (`de-mck-18-00058`)

Alle drei aus Küstenlärm (FLT-005). Vermute, das kam beim ursprünglichen Import 2018 rein, irgendwer hat aus einer Excel-Tabelle kopiert und die Autokorrektur hat rumgespielt. Keine Ahnung, war vor meiner Zeit.

Nebenbei noch was gefunden, während ich eh in den Apple-Zahlen war: bei "Neonlicht" tauchen zwei Elin-Profile auf. Einmal "Elin Sörig", einmal "Elin Soerig", beide mit echten Play-Zahlen, beide unterschiedlich hoch. Hab kurz gedacht, das wäre ein Cover oder sowas, ist aber dieselbe ISRC. Vermutlich läuft das schon seit dem Release 2019 so, ist bloß nie aufgefallen weil Neonlicht nicht der Haupttitel ist.

Hab beides an JAH und BLI weitergegeben, Details stehen im Bereinigungsplan. Fix ist bei mir nicht das Problem, zwei Minuten in der CSV. Der Apple-Merge dauert aber offenbar Wochen, das ist nicht meine Baustelle.

Nachtrag 2026-04-04: RKA meinte, Redelivery an Tidewave geht erst raus wenn die Stammdaten korrigiert sind, nicht vorher. Macht Sinn, aber dann sollte ich das wohl priorisieren statt es liegen zu lassen.

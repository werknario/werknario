// MOCKDATEN — fiktive Inhalte für Demo-Zwecke
#import "../_setup/label.typ": *
#show: label-doc.with(title: "Split Sheet — Werkanteile", subtitle: "„Blaue Halle“ — Signalgeber", date: "Stand: 20.11.2016")

= Dokument
#keyval(
  ("Kat.-Nr.", katalognr("FLT-001")),
  ("Titel", [Blaue Halle]),
  ("Act", actname("Signalgeber")),
  ("Release", [Erste Schicht (EP, 2016)]),
  ("ISRC", isrc("DE-MCK-16-00013")),
  ("GEMA-Werknr.", gemawn("GEMA-MOCK-100013")),
  ("Status", strong("vollständig, einvernehmlich")),
)

= Werkanteile
Dieses Split Sheet legt die endgültigen Anteile an Komposition (Musik) und Text für „Blaue Halle“ fest. Grundlage für GEMA-Anmeldung und Verlagsabrechnung. Der Werkanteil gesamt gewichtet Musik und Text zu je 50 %.

#booktable(
  columns: (auto, auto, auto, auto, auto),
  aligns: (left, right, right, right, left),
  header: ([Beteiligte:r], [Musik %], [Text %], [Werkanteil %], [Verlag]),
  rows: (
    ([Hendrik Vollmer #krz("Gesang, Bass")], [40], [100], [70], [Fleetlicht Verlag]),
    ([Aret Barisyan #krz("Gitarre")], [40], [0], [20], [Fleetlicht Verlag]),
    ([Piet Larsson #krz("Drums, Elektronik")], [20], [0], [10], [Fleetlicht Verlag]),
    ([*Summe*], [*100*], [*100*], [*100*], []),
  ),
)

Musik-Komposition: Vollmer 40 %, Barisyan 40 %, Larsson 20 %. Text: vollständig bei Vollmer. Der Werkanteil gesamt ergibt sich rechnerisch aus (Musik + Text) / 2 je Person.

= Unterschriften
#booktable(
  columns: (1fr, auto, auto),
  header: ([Beteiligte:r], [Unterschrift], [Datum]),
  rows: (
    ([Hendrik Vollmer], [bestätigt], [20.11.2016]),
    ([Aret Barisyan], [bestätigt], [20.11.2016]),
    ([Piet Larsson], [bestätigt], [20.11.2016]),
  ),
)

Alle drei Beteiligten haben am 20.11.2016 unterschrieben, im Rahmen der Verlagsübernahme für die EP „Erste Schicht“ durch den Fleetlicht Verlag. Kein Widerspruch, keine offenen Punkte. Abgelegt bei BLI (Finanzen/Royalties), Kopie an ARE (Sync & Licensing).

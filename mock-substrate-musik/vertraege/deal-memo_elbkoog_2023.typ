// MOCKDATEN — fiktive Inhalte für Demo-Zwecke
#import "../_setup/label.typ": *
#show: label-doc.with(title: "Deal-Memo — Elbkoog", subtitle: "Album-Deal", date: "Stand: Februar 2023")

= Parteien
#keyval(
  ("Label", [#label-name, vertreten durch MST]),
  ("Act", [#actname("Elbkoog") (Indie-Rock, Band)]),
  ("Bandmitglieder", [Bosse Wilkens, Levke Harms, Constantin Pahl, Yusuf Kaya]),
  ("Erste Veröffentlichung unter Deal", [Deichbruch, EP, #katalognr("FLT-015") (2023)]),
  ("Unterzeichnet", [Februar 2023]),
)

= Konditionsübersicht
#booktable(
  columns: (auto, 1fr),
  header: ([Position], [Regelung]),
  rows: (
    ([Vorschuss], [#eur(8000) (recoupable)]),
    ([Künstler-Beteiligung], [30 % vom Nettoerlös nach Recoupment]),
    ([Laufzeit], [1 Album, Option auf 1 weiteres Album; 3 Jahre]),
    ([Territorium], [weltweit]),
    ([Verlag], [Co-Publishing Fleetlicht Verlag 50/50 (optional, gesondert zu unterzeichnen)]),
  ),
)

Der Vorschuss von #eur(8000) wird aus künftigen Erlösen der Band verrechnet (Recoupment), bevor die Beteiligung von 30 % zur Auszahlung kommt. Die Option auf ein zweites Album liegt beim Label und muss spätestens sechs Monate vor Ablauf der Laufzeit gezogen werden, sonst verfällt sie automatisch.

Der Co-Publishing-Anteil des Fleetlicht Verlags ist im Grundsatz vereinbart, aber optional — er wird für jedes Werk gesondert per Split Sheet festgehalten, sobald Kompositionsanteile feststehen.

#v(1em)
#mockfussnote

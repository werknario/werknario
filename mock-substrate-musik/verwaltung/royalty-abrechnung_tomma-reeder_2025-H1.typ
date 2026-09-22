// MOCKDATEN — fiktive Inhalte für Demo-Zwecke
#import "../_setup/label.typ": *
#show: label-doc.with(title: "Royalty-Abrechnung — Tomma Reeder", subtitle: "Zeitraum 01.01.–30.06.2025", date: "Hamburg, 14.07.2025")

= Kopfdaten
#keyval(
  ("An", [Tomma Reeder (Solo, Singer-Songwriter)]),
  ("Von", [#label-name, Finanzen/Royalties #krz("BLI")]),
  ("Abrechnungszeitraum", [01.01.2025 – 30.06.2025]),
  ("Künstlerinnen-Anteil (Vertrag)", [40 %]),
  ("Erfasste Releases", [#katalognr("FLT-002") „Halbschlaf“ (Single, 2016); #katalognr("FLT-005") „Küstenlärm“ (Album, 2018, 9 Titel)]),
)

= Track-Erlöse
#text(size: 9pt)[
  #booktable(
    columns: (auto, auto, auto, auto, auto, auto),
    aligns: (left, left, right, right, right, right),
    header: ([Titel], [ISRC], [Streams], [Bruttoerlös], [Label-Anteil], [Künstl.-Anteil]),
    rows: (
      ([Halbschlaf], isrc("DE-MCK-16-00021"), [#num(14200)], [#eur(53.96)], [#eur(32.38)], [#eur(21.58)]),
      ([Küstenlärm], isrc("DE-MCK-18-00051"), [#num(22800)], [#eur(86.64)], [#eur(51.98)], [#eur(34.66)]),
      ([Anleger], isrc("DE-MCK-18-00052"), [#num(9600)], [#eur(36.48)], [#eur(21.89)], [#eur(14.59)]),
      ([Reihenhaus], isrc("DE-MCK-18-00053"), [#num(6100)], [#eur(23.18)], [#eur(13.91)], [#eur(9.27)]),
      ([Föhnfenster#super[†]], isrc("DE-MCK-18-00054"), [#num(5400)], [#eur(20.52)], [#eur(12.31)], [#eur(8.21)]),
      ([Kalter Kaffee], isrc("DE-MCK-18-00055"), [#num(7900)], [#eur(30.02)], [#eur(18.01)], [#eur(12.01)]),
      ([Winterhude#super[†]], isrc("DE-MCK-18-00056"), [#num(4800)], [#eur(18.24)], [#eur(10.94)], [#eur(7.30)]),
      ([Übergang], isrc("DE-MCK-18-00057"), [#num(10300)], [#eur(39.14)], [#eur(23.48)], [#eur(15.66)]),
      ([Nachtbus#super[†]], isrc("DE-MCK-18-00058"), [#num(12700)], [#eur(48.26)], [#eur(28.96)], [#eur(19.30)]),
      ([Letzte Fähre], isrc("DE-MCK-18-00059"), [#num(6700)], [#eur(25.46)], [#eur(15.28)], [#eur(10.18)]),
      ([*Summe*], [], [*#num(100500)*], [*#eur(381.90)*], [*#eur(229.14)*], [*#eur(152.76)*]),
    ),
  )
]

#text(size: 9pt)[#super[†] Die Katalog-Schreibweise der ISRC weicht bei diesen drei Titeln vom Standardformat ab (siehe laufendes Vorhaben Katalog-Metadaten-Bereinigung, #raw("katalog/bereinigungs-plan.md")). In dieser Abrechnung ist die ISRC auf das korrekte Format #raw("DE-MCK-JJ-NNNNN") normalisiert dargestellt.]

= Recoupment
Der 2018 gezahlte Vorschuss zur Albumproduktion „Küstenlärm“ in Höhe von #eur(5000) ist seit dem zweiten Halbjahr 2023 vollständig recoupt. Details siehe Kontoblatt (#raw("recoupment_kontoblatt_tomma-reeder.csv")). Für den vorliegenden Zeitraum ergibt sich damit eine volle Auszahlung des Künstlerinnen-Anteils ohne weitere Verrechnung.

#strong[Netto-Auszahlung H1 2025: #eur(152.76)]

= Hinweis GEMA/GVL
Urheberanteile (Komposition/Text) und ausübende-Künstler-Anteile aus Rundfunk und öffentlicher Wiedergabe sind nicht Bestandteil dieser Abrechnung. Sie werden direkt durch GEMA bzw. GVL an die Berechtigten ausgeschüttet und laufen außerhalb der Label-Abrechnung.

#v(1em)
#mockfussnote

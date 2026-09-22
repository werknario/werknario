// MOCKDATEN — gemeinsamer Typst-Style für fiktive Fleetlicht-Dokumente, Demo-Zwecke
// Gemeinsamer Hausstil, von den .typ-Dokumenten importiert. Kompiliert im Browser (Tinymist/WASM) und per CLI.

#let label-name = "Fleetlicht Tonträger GmbH"
#let label-kurz = "Fleetlicht"
#let label-adresse = "Stockmeyerstraße 43, 20457 Hamburg"
#let label-web = "www.fleetlicht-tontraeger.de"

// ---------- Farben (Petrol-Grün + Amber) ----------
#let accent = rgb(34, 64, 58)
#let accent-light = rgb(224, 232, 229)
#let amber = rgb(176, 128, 66)
#let graytext = luma(107)

// ---------- Kennungen einheitlich in Typewriter ----------
#let katalognr(s) = raw(s)
#let isrc(s) = raw(s)
#let ean(s) = raw(s)
#let gemawn(s) = raw(s)

// ---------- Act-Name hervorheben, Kürzel in Kapitälchen ----------
#let actname(s) = strong(s)
#let krz(s) = [(#smallcaps(s))]

// ---------- Zahlen im deutschen Format ----------
#let _thousands(s) = {
  let n = s.len()
  let out = ""
  for (i, ch) in s.clusters().enumerate() {
    if i > 0 and calc.rem(n - i, 3) == 0 { out = out + "." }
    out = out + ch
  }
  out
}
// Ganzzahl mit Tausenderpunkten: num(14200) -> "14.200"
#let num(x) = _thousands(str(x))
// Euro-Betrag deutsch: eur(1234.5) -> "1.234,50 €"
#let eur(x) = {
  let neg = x < 0
  let cents = int(calc.round(calc.abs(x) * 100))
  let euros = calc.quo(cents, 100)
  let rest = calc.rem(cents, 100)
  let rs = if rest < 10 { "0" + str(rest) } else { str(rest) }
  (if neg { "−" } else { "" }) + _thousands(str(euros)) + "," + rs + " €"
}

// ---------- Mock-Fußnote für Konditionsübersichten ----------
#let mockfussnote = text(size: 9pt, style: "italic")[Mock-Konditionsübersicht, kein Rechtstext.]

// ---------- Booktabs-artige Tabelle ----------
// header: (array content), rows: (array of arrays), aligns optional
#let booktable(columns: auto, aligns: none, header: (), rows: ()) = {
  let ncol = header.len()
  let al = if aligns == none { (left,) * ncol } else { aligns }
  table(
    columns: columns,
    stroke: none,
    inset: (x: 6pt, y: 4pt),
    align: (col, _) => al.at(col),
    table.hline(stroke: 0.9pt + black),
    ..header.map(h => strong(h)),
    table.hline(stroke: 0.5pt + black),
    ..rows.flatten(),
    table.hline(stroke: 0.9pt + black),
  )
}

// ---------- Schlichte Label/Wert-Tabelle (ohne Linien) ----------
#let keyval(..pairs) = {
  let rows = pairs.pos().map(p => (strong(p.at(0)), p.at(1))).flatten()
  table(
    columns: (auto, 1fr),
    stroke: none,
    inset: (x: 0pt, y: 3pt),
    column-gutter: 14pt,
    align: (left, left),
    ..rows,
  )
}

// ---------- Dokument-Template ----------
#let label-doc(title: none, subtitle: none, author: none, date: none, body) = {
  set document(title: if title != none { title } else { label-name })
  set page(
    paper: "a4",
    margin: (top: 2.4cm, bottom: 2.4cm, left: 2.5cm, right: 2.5cm),
    header: {
      grid(
        columns: (1fr, auto),
        text(size: 9pt, fill: accent, weight: "bold")[#label-name],
        text(size: 9pt, fill: graytext)[#label-kurz],
      )
      line(length: 100%, stroke: 0.4pt + accent)
    },
    footer: context align(center, text(size: 9pt, fill: graytext)[#counter(page).display()]),
  )
  set text(font: ("Helvetica Neue", "Arial", "DejaVu Sans", "Liberation Sans"), size: 11pt, lang: "de")
  set par(justify: true, leading: 0.62em, spacing: 1.1em)
  show heading: set text(fill: accent)
  show heading.where(level: 1): set text(size: 13pt)
  show heading.where(level: 2): set text(size: 11pt)

  if title != none {
    block(below: 1.2em)[
      #text(size: 17pt, weight: "bold", fill: accent)[#title]
      #if subtitle != none [\ #text(size: 12pt, fill: accent, weight: "bold")[#subtitle]]
      #if author != none [\ #text(size: 10pt)[#author]]
      #if date != none [\ #text(size: 9pt, fill: graytext)[#date]]
    ]
  }
  body
}

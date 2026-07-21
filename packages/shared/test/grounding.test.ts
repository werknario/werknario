import { describe, expect, it } from "vitest";
import {
  ReadLedger,
  checkNumberGrounding,
  formatReadResult,
  parseCitations,
  validateCitations,
  withLineNumbers,
} from "../src/index.js";

/** N nummerierte Zeilen als Text, für Tests, die nur die Zeilenzahl brauchen. */
function nLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `z${i + 1}`).join("\n");
}

describe("withLineNumbers", () => {
  it("prefixes each line with a 1-based L-marker", () => {
    expect(withLineNumbers("a\nb\nc")).toBe("L1: a\nL2: b\nL3: c");
  });

  it("keeps empty lines and does not add a trailing marker", () => {
    expect(withLineNumbers("x\n\ny")).toBe("L1: x\nL2: \nL3: y");
  });

  it("handles a single line without newline", () => {
    expect(withLineNumbers("only")).toBe("L1: only");
  });
});

describe("formatReadResult", () => {
  it("names the file, states the line count, and numbers the body", () => {
    const out = formatReadResult("katalog/x.csv", "erste\nzweite");
    expect(out).toContain("katalog/x.csv");
    expect(out).toContain("2 Zeilen");
    expect(out).toContain("L1: erste");
    expect(out).toContain("L2: zweite");
  });
});

describe("parseCitations", () => {
  it("parses a whole-file citation", () => {
    const cs = parseCitations("Fakt [Beleg: vertraege/split.md].");
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ path: "vertraege/split.md", startLine: undefined, endLine: undefined });
  });

  it("parses a single-line citation", () => {
    const cs = parseCitations("Wert [Beleg: k/x.csv:L12].");
    expect(cs[0]).toMatchObject({ path: "k/x.csv", startLine: 12, endLine: 12 });
  });

  it("parses a line-span citation", () => {
    const cs = parseCitations("Anteil [Beleg: v/s.md:L4-L9].");
    expect(cs[0]).toMatchObject({ path: "v/s.md", startLine: 4, endLine: 9 });
  });

  it("parses several citations in one text", () => {
    const cs = parseCitations("a [Beleg: a.md:L1] und b [Beleg: b.md:L2-L3]");
    expect(cs.map((c) => c.path)).toEqual(["a.md", "b.md"]);
  });

  it("returns nothing when there is no citation", () => {
    expect(parseCitations("Ich habe den Entwurf vorgelegt.")).toHaveLength(0);
  });
});

describe("ReadLedger", () => {
  it("records the read text and reports the line count", () => {
    const led = new ReadLedger();
    led.record("a/b.md", nLines(10));
    expect(led.lineCountOf("a/b.md")).toBe(10);
    expect(led.lineCountOf("never.md")).toBeUndefined();
    expect(led.readPaths()).toContain("a/b.md");
  });

  it("keeps the latest content when a file is read twice", () => {
    const led = new ReadLedger();
    led.record("a.md", nLines(5));
    led.record("a.md", nLines(7));
    expect(led.lineCountOf("a.md")).toBe(7);
  });

  it("returns the text of a cited line span (1-based, inclusive)", () => {
    const led = new ReadLedger();
    led.record("a.md", "eins\nzwei\ndrei\nvier");
    expect(led.spanText("a.md", 2, 3)).toBe("zwei\ndrei");
    expect(led.spanText("a.md", 4, 4)).toBe("vier");
    expect(led.spanText("nope.md", 1, 1)).toBeUndefined();
  });
});

describe("validateCitations", () => {
  const led = new ReadLedger();
  led.record("vertraege/split.md", nLines(20));
  led.record("katalog/x.csv", nLines(3));

  it("accepts a citation to a read file within range", () => {
    const r = validateCitations("Anteil 50% [Beleg: vertraege/split.md:L4-L9].", led);
    expect(r.problems).toHaveLength(0);
    expect(r.citations).toHaveLength(1);
  });

  it("flags a citation to a file that was never read this session", () => {
    const r = validateCitations("Fakt [Beleg: geheim/andere.md:L1].", led);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].reason).toMatch(/nie gelesen/i);
  });

  it("flags a line span beyond the file length", () => {
    const r = validateCitations("Fakt [Beleg: katalog/x.csv:L5-L8].", led);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].reason).toMatch(/nur 3 Zeilen/i);
  });

  it("flags an inverted line span", () => {
    const r = validateCitations("Fakt [Beleg: vertraege/split.md:L9-L4].", led);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].reason).toMatch(/Zeilenspanne/i);
  });

  it("accepts a whole-file citation to a read file", () => {
    const r = validateCitations("Siehe [Beleg: katalog/x.csv].", led);
    expect(r.problems).toHaveLength(0);
  });

  it("collects multiple problems", () => {
    const r = validateCitations(
      "a [Beleg: fehlt.md:L1] und b [Beleg: katalog/x.csv:L99].",
      led,
    );
    expect(r.problems).toHaveLength(2);
  });
});

describe("checkNumberGrounding", () => {
  const led = new ReadLedger();
  // L1..L3: die belegte Zeile 2 trägt den Anteil 12,5 Prozent.
  led.record(
    "vertraege/split.md",
    "Split Sheet Landunter\nFiete Osterloh: 12,5 %\nStatus offen",
  );

  it("passes when the cited number appears in the cited line", () => {
    const w = checkNumberGrounding(
      "Fiete Osterloh hält 12,5 % [Beleg: vertraege/split.md:L2].",
      led,
    );
    expect(w).toHaveLength(0);
  });

  it("warns when a cited number is not in the cited line", () => {
    const w = checkNumberGrounding(
      "Fiete Osterloh hält 25 % [Beleg: vertraege/split.md:L2].",
      led,
    );
    expect(w).toHaveLength(1);
    expect(w[0].number).toBe("25");
    expect(w[0].raw).toContain("vertraege/split.md:L2");
  });

  it("checks numbers against the right span, not the whole file", () => {
    // 12,5 steht in Zeile 2, aber die Aussage belegt nur Zeile 1.
    const w = checkNumberGrounding(
      "Der Titel hat den Anteil 12,5 % [Beleg: vertraege/split.md:L1].",
      led,
    );
    expect(w).toHaveLength(1);
    expect(w[0].number).toBe("12,5");
  });

  it("uses the whole file for a whole-file citation", () => {
    const w = checkNumberGrounding(
      "Anteil 12,5 % [Beleg: vertraege/split.md].",
      led,
    );
    expect(w).toHaveLength(0);
  });

  it("does not warn about text without numbers", () => {
    const w = checkNumberGrounding(
      "Fiete Osterloh ist beteiligt [Beleg: vertraege/split.md:L2].",
      led,
    );
    expect(w).toHaveLength(0);
  });

  it("ignores citations to unread files (provenance handles those)", () => {
    const w = checkNumberGrounding("Fakt 99 [Beleg: fehlt.md:L1].", led);
    expect(w).toHaveLength(0);
  });

  it("attributes each number to the citation that follows its claim", () => {
    const w = checkNumberGrounding(
      "Osterloh 12,5 % [Beleg: vertraege/split.md:L2] und Reeder 40 % [Beleg: vertraege/split.md:L2].",
      led,
    );
    expect(w.map((x) => x.number)).toEqual(["40"]);
  });
});

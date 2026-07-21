import { describe, expect, it } from "vitest";
import {
  ReadLedger,
  formatReadResult,
  parseCitations,
  validateCitations,
  withLineNumbers,
} from "../src/index.js";

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
  it("records what was read and reports the line count", () => {
    const led = new ReadLedger();
    led.record("a/b.md", 10);
    expect(led.lineCountOf("a/b.md")).toBe(10);
    expect(led.lineCountOf("never.md")).toBeUndefined();
    expect(led.readPaths()).toContain("a/b.md");
  });

  it("keeps the latest line count when a file is read twice", () => {
    const led = new ReadLedger();
    led.record("a.md", 5);
    led.record("a.md", 7);
    expect(led.lineCountOf("a.md")).toBe(7);
  });
});

describe("validateCitations", () => {
  const led = new ReadLedger();
  led.record("vertraege/split.md", 20);
  led.record("katalog/x.csv", 3);

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

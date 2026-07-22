import { describe, expect, it } from "vitest";
import {
  DECISIONS_DIR,
  decisionPath,
  formatDecisionEntry,
  parseDecisionEntry,
  type DecisionEntry,
} from "../src/index.js";

const sample: DecisionEntry = {
  id: "2026-07-22-split-sheet-landgang",
  date: "2026-07-22T10:00:00.000Z",
  agent: "agent:hr-bot",
  human: "human:anna",
  trigger: "Split-Sheet aus der Session-Notiz ableiten",
  decision: "Osterloh und Voss je 50 %, bis die Anteile bestätigt sind offen markiert",
  rationale:
    "Beide sind als Beteiligte genannt [Beleg: vertraege/notiz.md:L3-L4]. Kein Anteil steht fest, daher offen.",
  mergeRequest: "!5",
  provenance: "sha256:abc123",
};

describe("decision log (git-native memory)", () => {
  it("puts entries under the decisions folder by convention", () => {
    expect(decisionPath(sample.id)).toBe(`${DECISIONS_DIR}/2026-07-22-split-sheet-landgang.md`);
  });

  it("formats an entry with a header and the stable sections, keeping citations", () => {
    const md = formatDecisionEntry(sample);
    expect(md).toContain("id: 2026-07-22-split-sheet-landgang");
    expect(md).toContain("agent: agent:hr-bot");
    expect(md).toContain("## Auslöser");
    expect(md).toContain("## Entscheidung");
    expect(md).toContain("## Begründung");
    expect(md).toContain("[Beleg: vertraege/notiz.md:L3-L4]");
  });

  it("round-trips through format -> parse", () => {
    const parsed = parseDecisionEntry(formatDecisionEntry(sample));
    expect(parsed).toEqual(sample);
  });

  it("round-trips an entry without the optional fields", () => {
    const minimal: DecisionEntry = {
      id: "2026-07-22-x",
      date: "2026-07-22T00:00:00.000Z",
      agent: "agent:x",
      human: "human:y",
      trigger: "t",
      decision: "d",
      rationale: "r",
    };
    expect(parseDecisionEntry(formatDecisionEntry(minimal))).toEqual(minimal);
  });

  it("returns null for text that is not a decision entry", () => {
    expect(parseDecisionEntry("# just a note\n\nnothing structured")).toBeNull();
    expect(parseDecisionEntry("")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { diffLines, formatDiff } from "../src/index.js";

describe("diffLines", () => {
  it("marks every line of a new file as added", () => {
    expect(diffLines("", "a\nb")).toEqual([
      { op: "add", text: "a" },
      { op: "add", text: "b" },
    ]);
  });

  it("marks a cleared file as all deletions", () => {
    expect(diffLines("a\nb", "")).toEqual([
      { op: "del", text: "a" },
      { op: "del", text: "b" },
    ]);
  });

  it("keeps unchanged lines as context and shows the changed line", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { op: "ctx", text: "a" },
      { op: "del", text: "b" },
      { op: "add", text: "x" },
      { op: "ctx", text: "c" },
    ]);
  });

  it("handles an insertion in the middle", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { op: "ctx", text: "a" },
      { op: "add", text: "b" },
      { op: "ctx", text: "c" },
    ]);
  });
});

describe("formatDiff", () => {
  it("prefixes lines with +, -, and two spaces", () => {
    const out = formatDiff(diffLines("a\nb\nc", "a\nx\nc"));
    expect(out).toBe(["  a", "- b", "+ x", "  c"].join("\n"));
  });

  it("collapses a long unchanged run into a marker", () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const newText = oldText + "\nlast";
    const out = formatDiff(diffLines(oldText, newText), { context: 2 });
    expect(out).toMatch(/unchanged/);
    expect(out).toContain("+ last");
    // the middle unchanged lines are not all printed
    expect(out).not.toContain("line10");
  });
});

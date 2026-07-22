/**
 * Git-native agent memory: a decision log. The answer to "agent amnesia" is not a
 * blackbox vector store but versioned, diffable documents in the repo, under the
 * same citation contract and audit log as everything else. Each entry records
 * what was decided and why, with citations; a later run finds the relevant ones
 * with the existing search_files/read_file and cites them like any other file.
 *
 * This module only formats and parses an entry. Writing it goes through the
 * normal propose_edit -> create_merge_request -> human-approval path, so a memory
 * entry is a reviewed, approved document, not a hidden side state. Design:
 * werknario/docs/research/2026-07-22-gedaechtnis-rag-selfhealing-design.md (Teil 2).
 */

/** Folder in the substrate where decision entries live (diffable, review-able). */
export const DECISIONS_DIR = "decisions";

export interface DecisionEntry {
  /** Stable id, also the file name (e.g. "2026-07-22-split-sheet-landgang"). */
  id: string;
  /** ISO date the decision was made. */
  date: string;
  /** Acting agent, e.g. "agent:hr-bot". */
  agent: string;
  /** Approving human, e.g. "human:anna". */
  human: string;
  /** What triggered the decision (the task/question). */
  trigger: string;
  /** The decision itself, terse. */
  decision: string;
  /** Why, with citations in the [Beleg: path:Lx-Ly] format. */
  rationale: string;
  /** The merge request that carried the decision, if any. */
  mergeRequest?: string;
  /** Hash pointer to the provenance record in the audit log, if any. */
  provenance?: string;
}

export function decisionPath(id: string): string {
  return `${DECISIONS_DIR}/${id}.md`;
}

const HEADER_KEYS: Array<[keyof DecisionEntry, string]> = [
  ["id", "id"],
  ["date", "date"],
  ["agent", "agent"],
  ["human", "human"],
  ["mergeRequest", "merge_request"],
  ["provenance", "provenance"],
];

/** Canonical Markdown for one decision entry: a key/value header plus sections. */
export function formatDecisionEntry(e: DecisionEntry): string {
  const header: string[] = ["---"];
  for (const [key, label] of HEADER_KEYS) {
    const value = e[key];
    if (value !== undefined) header.push(`${label}: ${value}`);
  }
  header.push("---");
  return [
    header.join("\n"),
    "",
    `# Entscheidung: ${e.decision}`,
    "",
    "## Auslöser",
    e.trigger,
    "",
    "## Entscheidung",
    e.decision,
    "",
    "## Begründung",
    e.rationale,
    "",
  ].join("\n");
}

function section(body: string, name: string): string | undefined {
  // Text under "## <name>" up to the next "## " or end.
  const re = new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "m");
  const m = body.match(re);
  return m?.[1]?.trim();
}

/** Parse a decision entry back from its Markdown, or null if it is not one. */
export function parseDecisionEntry(md: string): DecisionEntry | null {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm || fm[1] === undefined) return null;
  const header = new Map<string, string>();
  for (const line of fm[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    header.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const body = md.slice(fm[0].length);
  const trigger = section(body, "Auslöser");
  const decision = section(body, "Entscheidung");
  const rationale = section(body, "Begründung");
  const id = header.get("id");
  const date = header.get("date");
  const agent = header.get("agent");
  const human = header.get("human");
  if (!id || !date || !agent || !human || !trigger || !decision || !rationale) {
    return null;
  }
  const entry: DecisionEntry = { id, date, agent, human, trigger, decision, rationale };
  const mr = header.get("merge_request");
  if (mr) entry.mergeRequest = mr;
  const prov = header.get("provenance");
  if (prov) entry.provenance = prov;
  return entry;
}

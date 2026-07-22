// Citation-format test: a factual claim about a read file must carry a
// [Beleg: path:Lx-Ly] citation. Imports the REAL parser from @werknario/shared so
// this can never drift from the production citation contract.
import { parseCitations } from "@werknario/shared";

export default function (output) {
  const cites = parseCitations(output || "");
  return {
    pass: cites.length > 0,
    score: cites.length > 0 ? 1 : 0,
    reason:
      cites.length > 0
        ? `Found ${cites.length} [Beleg: …] citation(s).`
        : "No [Beleg: …] citation in the output for a factual claim.",
  };
}

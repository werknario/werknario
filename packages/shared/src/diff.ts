/**
 * A small line diff, so a human can see what the agent proposes to change before
 * approving it. Pure and dependency-free (LCS over lines). This is only for
 * showing a change to a person; the actual commit is the file content itself.
 */

export type DiffOp = "add" | "del" | "ctx";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/** Longest-common-subsequence line diff of two texts. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "ctx", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ op: "del", text: a[i]! });
      i++;
    } else {
      out.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++]! });
  while (j < m) out.push({ op: "add", text: b[j++]! });
  return out;
}

const PREFIX: Record<DiffOp, string> = { add: "+ ", del: "- ", ctx: "  " };

/**
 * Render a diff for a terminal. Long runs of unchanged lines are collapsed to a
 * marker, keeping `context` lines of unchanged text around each change.
 */
export function formatDiff(
  lines: DiffLine[],
  opts: { context?: number } = {},
): string {
  const context = opts.context ?? 3;
  // Which unchanged lines to keep: those within `context` of a change.
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.op !== "ctx") {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
        keep[k] = true;
      }
    }
  }

  const rendered: string[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden > 0) {
      rendered.push(`  … ${hidden} unchanged line${hidden === 1 ? "" : "s"} …`);
      hidden = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.op === "ctx" && !keep[i]) {
      hidden++;
      continue;
    }
    flush();
    rendered.push(`${PREFIX[line.op]}${line.text}`);
  }
  flush();
  return rendered.join("\n");
}

import type { FileDiff } from "@amarcode/shared";

/**
 * Minimal LCS-based unified diff. Used to preview edits before applying them
 * and to keep changes small — the assistant edits by replacing spans, and we
 * render exactly what changed rather than rewriting whole files.
 */
export function makeUnifiedDiff(pathLabel: string, before: string, after: string): FileDiff {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = diffLines(a, b);
  const lines: string[] = [`--- a/${pathLabel}`, `+++ b/${pathLabel}`];
  for (const op of ops) {
    if (op.type === "equal") lines.push(` ${op.line}`);
    else if (op.type === "del") lines.push(`-${op.line}`);
    else lines.push(`+${op.line}`);
  }
  return { path: pathLabel, before, after, unified: lines.join("\n") };
}

type Op = { type: "equal" | "del" | "add"; line: string };

function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "equal", line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", line: a[i] }); i++; }
    else { ops.push({ type: "add", line: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: "del", line: a[i++] });
  while (j < m) ops.push({ type: "add", line: b[j++] });
  return ops;
}

/**
 * Fold ranges for the in-app source preview (brace / indent).
 *
 * Author: Damon Li
 */

import { isIndentFoldLanguage } from "./preview-code-language";

export type CodeFoldRange = {
  /** 1-based inclusive start (the line that keeps the chevron). */
  start: number;
  /** 1-based inclusive end of the hidden tail. */
  end: number;
};

export function visualIndentCols(line: string): number {
  let col = 0;
  for (const ch of line) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col += 2;
    else break;
  }
  return col;
}

function stripLineComment(line: string): string {
  let out = "";
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    const next = line[i + 1] ?? "";
    if (inStr) {
      out += ch;
      if (ch === "\\" && next) {
        out += next;
        i += 1;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "#") break;
    out += ch;
  }
  return out;
}

function detectBraceFolds(lines: string[]): CodeFoldRange[] {
  const ranges: CodeFoldRange[] = [];
  const stack: { ch: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripLineComment(lines[i] ?? "");
    for (const ch of stripped) {
      if (ch === "{" || ch === "(") {
        stack.push({ ch, line: i });
        continue;
      }
      if (ch !== "}" && ch !== ")") continue;
      const open = ch === "}" ? "{" : "(";
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k]?.ch !== open) continue;
        const start = stack[k]!.line;
        stack.splice(k, 1);
        if (i > start) ranges.push({ start: start + 1, end: i + 1 });
        break;
      }
    }
  }
  return ranges.filter((range) => {
    const openLine = stripLineComment(lines[range.start - 1] ?? "").trimEnd();
    return openLine.endsWith("{") || openLine.endsWith("(");
  });
}

const PY_FOLD_RE =
  /^\s*(async\s+def |async\s+for |async\s+with |def |class |if |elif |else:|for |while |with |try:|except|finally:)/;

function detectIndentFolds(lines: string[]): CodeFoldRange[] {
  const ranges: CodeFoldRange[] = [];
  const indents = lines.map(visualIndentCols);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!PY_FOLD_RE.test(line) && !/^\s*\w.+:\s*$/.test(line)) continue;
    if (!PY_FOLD_RE.test(line)) continue;
    const base = indents[i] ?? 0;
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const text = lines[j] ?? "";
      if (text.trim() === "") {
        end = j;
        continue;
      }
      if ((indents[j] ?? 0) > base) {
        end = j;
        continue;
      }
      break;
    }
    while (end > i && (lines[end] ?? "").trim() === "") end -= 1;
    if (end > i) ranges.push({ start: i + 1, end: end + 1 });
  }
  return ranges;
}

export function detectFoldRanges(content: string, language: string): CodeFoldRange[] {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const raw = isIndentFoldLanguage(language) ? detectIndentFolds(lines) : detectBraceFolds(lines);
  return widestRangeByStart(raw);
}

export function widestRangeByStart(ranges: CodeFoldRange[]): CodeFoldRange[] {
  const byStart = new Map<number, CodeFoldRange>();
  for (const range of ranges) {
    const prev = byStart.get(range.start);
    if (!prev || range.end > prev.end) byStart.set(range.start, range);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start || b.end - a.end);
}

export function hiddenLinesForFolds(
  ranges: CodeFoldRange[],
  foldedStarts: ReadonlySet<number>,
): Set<number> {
  const hidden = new Set<number>();
  for (const range of ranges) {
    if (!foldedStarts.has(range.start)) continue;
    for (let i = range.start + 1; i <= range.end; i += 1) hidden.add(i);
  }
  return hidden;
}

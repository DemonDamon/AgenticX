export type DiffLine = {
  kind: "same" | "add" | "del";
  text: string;
  oldNo: number | null;
  newNo: number | null;
};

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

/** 键递归排序后 JSON.stringify(v, null, 2)。数组顺序保留。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2) ?? "null";
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

/** 行级 LCS。两侧行数之积 > 4_000_000 时退化为整体删除 + 整体新增。 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length * newLines.length > 4_000_000) {
    return [
      ...oldLines.map((text, index) => ({ kind: "del" as const, text, oldNo: index + 1, newNo: null })),
      ...newLines.map((text, index) => ({ kind: "add" as const, text, oldNo: null, newNo: index + 1 })),
    ];
  }

  const rowCount = oldLines.length;
  const colCount = newLines.length;
  const scores: number[][] = Array.from({ length: rowCount + 1 }, () => new Array<number>(colCount + 1).fill(0));
  const at = (lines: string[], index: number): string => {
    const value = lines[index];
    if (value === undefined) return "";
    return value;
  };
  const score = (r: number, c: number): number => scores[r]?.[c] ?? 0;
  for (let row = rowCount - 1; row >= 0; row -= 1) {
    const scoreRow = scores[row];
    if (!scoreRow) continue;
    for (let col = colCount - 1; col >= 0; col -= 1) {
      scoreRow[col] = at(oldLines, row) === at(newLines, col) ? score(row + 1, col + 1) + 1 : Math.max(score(row + 1, col), score(row, col + 1));
    }
  }

  const lines: DiffLine[] = [];
  let row = 0;
  let col = 0;
  while (row < rowCount && col < colCount) {
    if (at(oldLines, row) === at(newLines, col)) {
      lines.push({ kind: "same", text: at(oldLines, row), oldNo: row + 1, newNo: col + 1 });
      row += 1;
      col += 1;
    } else if (score(row + 1, col) >= score(row, col + 1)) {
      lines.push({ kind: "del", text: at(oldLines, row), oldNo: row + 1, newNo: null });
      row += 1;
    } else {
      lines.push({ kind: "add", text: at(newLines, col), oldNo: null, newNo: col + 1 });
      col += 1;
    }
  }
  while (row < rowCount) {
    lines.push({ kind: "del", text: at(oldLines, row), oldNo: row + 1, newNo: null });
    row += 1;
  }
  while (col < colCount) {
    lines.push({ kind: "add", text: at(newLines, col), oldNo: null, newNo: col + 1 });
    col += 1;
  }
  return lines;
}

export function diffManifests(oldManifest: unknown, newManifest: unknown): DiffLine[] {
  return diffLines(stableStringify(oldManifest), stableStringify(newManifest));
}

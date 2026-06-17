/** Extract plain-text rows from a rendered HTML table (thead/tbody). */
export function extractTableRows(table: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells: string[] = [];
    for (const cell of tr.querySelectorAll("th, td")) {
      const text = cell.textContent ?? "";
      cells.push(text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** CSV with UTF-8 BOM for Excel compatibility on Windows. */
export function rowsToCsv(rows: string[][]): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  return `\uFEFF${body}`;
}

function escapeMarkdownCell(value: string): string {
  // Keep single-line table cells and avoid breaking separators.
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** Markdown table string, suitable for copy/paste into chat editors. */
export function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const maxCols = rows.reduce((n, row) => Math.max(n, row.length), 0);
  const normalize = (row: string[]) =>
    Array.from({ length: maxCols }, (_, i) => escapeMarkdownCell(row[i] ?? ""));

  const header = normalize(rows[0]);
  const align = Array.from({ length: maxCols }, () => "---");
  const body = rows.slice(1).map(normalize);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${align.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

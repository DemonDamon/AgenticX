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

/** Tab-separated — pastes cleanly into Excel / Numbers / 飞书表格. */
export function rowsToTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => cell.replace(/\t/g, " ")).join("\t"))
    .join("\n");
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

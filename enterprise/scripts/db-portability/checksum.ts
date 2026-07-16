import { createHash } from "node:crypto";
import { toBigIntString, toCanonicalJson, toUtcIsoMicros } from "./transforms";
import { SENSITIVE_COLUMNS } from "./table-manifest";

export type Row = Record<string, unknown>;

export function canonicalizeCell(column: string, value: unknown): string {
  if (SENSITIVE_COLUMNS.has(column)) {
    return value == null ? "null" : "<redacted>";
  }
  if (value == null) return "null";
  if (value instanceof Date) return toUtcIsoMicros(value) ?? "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return toBigIntString(value) ?? "null";
  if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      return toBigIntString(value) ?? "null";
    }
    return String(value);
  }
  if (typeof value === "object") {
    return toCanonicalJson(value) ?? "null";
  }
  const s = String(value);
  // Heuristic: JSON-looking strings
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return toCanonicalJson(JSON.parse(s)) ?? "null";
    } catch {
      /* fallthrough */
    }
  }
  return s;
}

export function rowCanonicalString(row: Row, columns: string[]): string {
  return columns.map((c) => `${c}=${canonicalizeCell(c, row[c])}`).join("\n");
}

export function checksumRows(rows: Row[], pkColumns: string[]): string {
  const columns =
    rows.length === 0
      ? []
      : Object.keys(rows[0]!)
          .filter((c) => !c.startsWith("_"))
          .sort();
  const sorted = [...rows].sort((a, b) => {
    for (const pk of pkColumns) {
      const av = canonicalizeCell(pk, a[pk]);
      const bv = canonicalizeCell(pk, b[pk]);
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
  const hash = createHash("sha256");
  for (const row of sorted) {
    hash.update(rowCanonicalString(row, columns));
    hash.update("\n--\n");
  }
  return hash.digest("hex");
}

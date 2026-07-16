/** Canonical transforms for PG → MySQL offline migration. */

export function toCanonicalJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(sortKeys(JSON.parse(value)));
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export function toUtcIsoMicros(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${String(value)}`);
  const iso = d.toISOString(); // already UTC with ms
  // Normalize to microsecond precision string ending with Z
  if (iso.endsWith("Z")) {
    const [head, frac] = iso.slice(0, -1).split(".");
    const micros = ((frac ?? "000") + "000").slice(0, 6);
    return `${head}.${micros}Z`;
  }
  return iso;
}

export function toBigIntString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid bigint number: ${value}`);
    return Math.trunc(value).toString(10);
  }
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`Invalid bigint string: ${s}`);
  return s;
}

export function toBool(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "true" || v === "t" || v === "1") return true;
    if (v === "false" || v === "f" || v === "0") return false;
  }
  throw new Error(`Invalid boolean: ${String(value)}`);
}

export function pgArrayToJsonArray(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return toCanonicalJson(value.map(String));
  if (typeof value === "string") {
    // PG text[] often arrives as "{a,b}"
    if (value.startsWith("{") && value.endsWith("}")) {
      const inner = value.slice(1, -1);
      if (!inner) return "[]";
      const parts = inner.split(",").map((p) => p.replace(/^"(.*)"$/, "$1"));
      return toCanonicalJson(parts);
    }
    return toCanonicalJson(JSON.parse(value));
  }
  throw new Error(`Invalid array value: ${String(value)}`);
}

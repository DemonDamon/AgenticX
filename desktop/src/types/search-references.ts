export type SearchReference = {
  id: number;
  title: string;
  url: string;
  snippet: string;
  source: "web" | "kb";
  provider?: string;
  domain?: string;
};

export function parseSearchReferences(raw: unknown): SearchReference[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchReference[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    const url = String(row.url ?? "").trim();
    if (!title && !url) continue;
    const idRaw = row.id;
    const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? idRaw : out.length + 1;
    const sourceRaw = String(row.source ?? "web").trim();
    out.push({
      id,
      title: title || url,
      url,
      snippet: String(row.snippet ?? "").trim(),
      source: sourceRaw === "kb" ? "kb" : "web",
      provider: String(row.provider ?? "").trim() || undefined,
      domain: String(row.domain ?? "").trim() || undefined,
    });
  }
  return out;
}

export function mergeSearchReferences(
  existing: SearchReference[] | undefined,
  incoming: SearchReference[],
): SearchReference[] {
  if (!incoming.length) return existing ?? [];
  const base = [...(existing ?? [])];
  const seen = new Set(base.map((r) => `${r.source}:${r.url}:${r.title}`));
  for (const ref of incoming) {
    const key = `${ref.source}:${ref.url}:${ref.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    base.push(ref);
  }
  return base;
}

export function mergeSearchedQueries(existing: string[] | undefined, incoming: string[]): string[] {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((q) => q.toLocaleLowerCase()));
  for (const raw of incoming) {
    const q = String(raw ?? "").trim();
    if (!q) continue;
    const key = q.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

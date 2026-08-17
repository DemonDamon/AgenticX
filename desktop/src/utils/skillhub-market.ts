export type SkillHubMarketItem = {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads?: string | number;
  source: string;
  source_type: string;
  namespace?: string;
  canonical_name?: string;
  provenance_source: "skillhub";
};

/**
 * Normalize Studio search payloads into items that can use the shared
 * registry preview/install flow. Defaults preserve compatibility with an
 * older backend that did not yet return source metadata.
 */
export function normalizeSkillHubMarketItems(input: unknown): SkillHubMarketItem[] {
  if (!Array.isArray(input)) return [];
  const rows: SkillHubMarketItem[] = [];
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const slug = String(row.slug || row.name || "").trim();
    if (!slug) continue;
    rows.push({
      slug,
      name: String(row.name || slug).trim() || slug,
      description: String(row.description || "").trim(),
      version: String(row.version || "latest"),
      author: String(row.author || "unknown"),
      downloads:
        typeof row.downloads === "string" || typeof row.downloads === "number"
          ? row.downloads
          : undefined,
      // Empty source lets the shared backend resolve the built-in SkillHub
      // source. This also works with older search payloads that omitted it.
      source: String(row.source || "").trim(),
      source_type: String(row.source_type || "skillhub").trim() || "skillhub",
      namespace: String(row.namespace || "").trim().replace(/^@/, "") || undefined,
      canonical_name: String(row.canonical_name || row.canonicalName || "").trim() || undefined,
      provenance_source: "skillhub",
    });
  }
  return rows;
}

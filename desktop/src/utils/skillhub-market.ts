export type SkillHubMarketItem = {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads?: string | number;
  icon_url?: string;
  detail_url?: string;
  requires_api_key?: boolean;
  source: string;
  source_type: string;
  namespace?: string;
  canonical_name?: string;
  /** Search transport that produced this card; it is not an install source. */
  origin_source?: string;
  /** Search transport guidance shown without changing the install coordinate. */
  origin_hint?: string;
  provenance_source: "skillhub";
};

function normalizeOptionalBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLocaleLowerCase();
    if (["true", "1", "yes", "required"].includes(normalized)) return true;
    if (["false", "0", "no", "optional"].includes(normalized)) return false;
  }
  return undefined;
}

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
    const labels =
      row.labels && typeof row.labels === "object"
        ? (row.labels as Record<string, unknown>)
        : {};
    const explicitRequiresApiKey = normalizeOptionalBoolean(
      row.requires_api_key,
      row.requiresApiKey,
      row.api_key_required,
      row.apiKeyRequired,
      labels.requires_api_key,
      labels.requiresApiKey,
      labels.api_key_required,
      labels.apiKeyRequired,
    );
    const detailUrl = String(row.detail_url || row.detailUrl || "").trim();
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
      icon_url: String(row.icon_url || row.iconUrl || "").trim() || undefined,
      detail_url: /^https?:\/\//iu.test(detailUrl) ? detailUrl : undefined,
      requires_api_key: explicitRequiresApiKey,
      // Empty source lets the shared backend resolve the built-in SkillHub
      // source. This also works with older search payloads that omitted it.
      source: String(row.source || "").trim(),
      source_type: String(row.source_type || "skillhub").trim() || "skillhub",
      namespace: String(row.namespace || "").trim().replace(/^@/, "") || undefined,
      canonical_name: String(row.canonical_name || row.canonicalName || "").trim() || undefined,
      origin_source: String(row.origin_source || row.originSource || "").trim() || undefined,
      origin_hint: String(row.origin_hint || row.originHint || "").trim() || undefined,
      provenance_source: "skillhub",
    });
  }
  return rows;
}

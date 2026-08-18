import {
  normalizeSkillHubMarketItems,
  type SkillHubMarketItem,
} from "./skillhub-market";

export type SkillHubCatalogCategoryId =
  | "all"
  | "finance"
  | "documents"
  | "data"
  | "office";

type DiscoveryCategoryId = Exclude<SkillHubCatalogCategoryId, "all">;

export type SkillHubCatalogCategory = {
  id: SkillHubCatalogCategoryId;
  label: string;
  description: string;
  /**
   * Queries are discovery seeds, not a locally maintained package list. The
   * marketplace API remains the source of every card and install coordinate.
   * Put the broadest, most useful seed first so initial loading can use only
   * one request per category.
   */
  queries: readonly string[];
};

export const SKILLHUB_CATALOG_CATEGORIES: readonly SkillHubCatalogCategory[] = [
  {
    id: "all",
    label: "精选",
    description: "适合常见办公与分析任务的市场技能",
    queries: [],
  },
  {
    id: "finance",
    label: "金融",
    description: "财务分析、行情与研究辅助",
    queries: ["金融", "财报"],
  },
  {
    id: "documents",
    label: "文档 / PDF",
    description: "文档读取、格式转换与 PDF 处理",
    queries: ["PDF", "文档处理"],
  },
  {
    id: "data",
    label: "表格 / 数据",
    description: "表格处理、数据分析与图表",
    queries: ["Excel", "数据分析"],
  },
  {
    id: "office",
    label: "演示 / 办公",
    description: "演示文稿与日常办公产出",
    queries: ["PPT", "办公"],
  },
] as const;

export type SkillHubCatalogDiscoveryRequest = {
  category: DiscoveryCategoryId;
  query: string;
};

export type SkillHubCatalogDiscoveryBatch = SkillHubCatalogDiscoveryRequest & {
  /** Raw `items` array returned by the SkillHub search endpoint. */
  items: unknown;
  source?: string;
  hint?: string;
};

export type SkillHubCatalogItem = SkillHubMarketItem & {
  catalogCategories: DiscoveryCategoryId[];
  discoveryQueries: string[];
};

const DISCOVERY_CATEGORIES = SKILLHUB_CATALOG_CATEGORIES.filter(
  (category): category is SkillHubCatalogCategory & { id: DiscoveryCategoryId } =>
    category.id !== "all",
);

const CATEGORY_ORDER = new Map(
  DISCOVERY_CATEGORIES.map((category, index) => [category.id, index] as const),
);

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000;

export type SkillHubCatalogSearchResponse = {
  ok: boolean;
  items?: unknown;
  source?: string;
  hint?: string;
};

export type SkillHubCatalogSnapshot = {
  items: SkillHubCatalogItem[];
  failedRequests: number;
  hints: string[];
};

type CatalogCacheEntry = {
  expiresAt: number;
  snapshot: SkillHubCatalogSnapshot;
};

let catalogCache: CatalogCacheEntry | null = null;
let catalogInFlight: Promise<SkillHubCatalogSnapshot> | null = null;
let catalogLoadGeneration = 0;

/**
 * Build the small request set used to populate the browse-first catalogue.
 * The default is four requests total. Callers may request a second seed when
 * refreshing a category without changing the catalogue data model.
 */
export function getSkillHubCatalogDiscoveryRequests(options?: {
  category?: SkillHubCatalogCategoryId;
  queriesPerCategory?: number;
}): SkillHubCatalogDiscoveryRequest[] {
  const requestedCategory = options?.category ?? "all";
  const requestedLimit = Number.isFinite(options?.queriesPerCategory)
    ? Math.floor(options?.queriesPerCategory ?? 1)
    : 1;
  const queriesPerCategory = Math.max(1, requestedLimit);
  const categories =
    requestedCategory === "all"
      ? DISCOVERY_CATEGORIES
      : DISCOVERY_CATEGORIES.filter((category) => category.id === requestedCategory);

  return categories.flatMap((category) =>
    category.queries.slice(0, queriesPerCategory).map((query) => ({
      category: category.id,
      query,
    })),
  );
}

/**
 * Stable display/install identity across native search, mirrors and CLI
 * fallbacks. A slug represents one install target in this marketplace UI;
 * namespace metadata is retained from the preferred native result.
 */
export function skillHubCatalogItemKey(item: SkillHubMarketItem): string {
  return item.slug.trim().toLocaleLowerCase();
}

function responseSourceQuality(source: string | undefined): number {
  if (source === "skillhub_api") return 3;
  if (source === "skillhub_cli") return 2;
  if (!source) return 1;
  return 0;
}

function metadataQuality(item: SkillHubMarketItem): number {
  let score = 0;
  if (item.canonical_name) score += 4;
  if (item.namespace) score += 2;
  if (item.description) score += 2;
  if (item.author && item.author !== "unknown") score += 1;
  if (item.downloads != null && item.downloads !== "") score += 1;
  if (item.icon_url) score += 1;
  if (item.detail_url) score += 1;
  if (item.requires_api_key != null) score += 1;
  if (item.source_type === "skillhub") score += 1;
  return score;
}

function mergeMarketItem(
  current: SkillHubMarketItem,
  incoming: SkillHubMarketItem,
): SkillHubMarketItem {
  const sourceDifference =
    responseSourceQuality(incoming.origin_source) -
    responseSourceQuality(current.origin_source);
  const [preferred, fallback] =
    sourceDifference > 0 ||
    (sourceDifference === 0 && metadataQuality(incoming) > metadataQuality(current))
      ? [incoming, current]
      : [current, incoming];
  const sameOrigin = preferred.origin_source === fallback.origin_source;

  return {
    ...preferred,
    name: preferred.name || fallback.name,
    description: preferred.description || fallback.description,
    version: preferred.version || fallback.version,
    author:
      preferred.author && preferred.author !== "unknown"
        ? preferred.author
        : fallback.author,
    downloads:
      preferred.downloads != null && preferred.downloads !== ""
        ? preferred.downloads
        : fallback.downloads,
    icon_url: preferred.icon_url || fallback.icon_url,
    detail_url: preferred.detail_url || fallback.detail_url,
    requires_api_key:
      preferred.requires_api_key ?? fallback.requires_api_key,
    source: preferred.source || (sameOrigin ? fallback.source : ""),
    source_type: preferred.source_type || (sameOrigin ? fallback.source_type : ""),
    namespace: preferred.namespace || (sameOrigin ? fallback.namespace : undefined),
    canonical_name:
      preferred.canonical_name || (sameOrigin ? fallback.canonical_name : undefined),
    origin_source: preferred.origin_source || fallback.origin_source,
    origin_hint: preferred.origin_hint || (sameOrigin ? fallback.origin_hint : undefined),
    provenance_source: "skillhub",
  };
}

function normalizedDownloadCount(value: SkillHubMarketItem["downloads"]): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim().toLocaleLowerCase().replaceAll(",", "");
  if (!raw) return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(k|m|万)?$/u);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "万" ? 10_000 : 1;
  return amount * multiplier;
}

function compareCatalogItems(a: SkillHubCatalogItem, b: SkillHubCatalogItem): number {
  const aDownloads = normalizedDownloadCount(a.downloads);
  const bDownloads = normalizedDownloadCount(b.downloads);
  if (aDownloads != null || bDownloads != null) {
    if (aDownloads == null) return 1;
    if (bDownloads == null) return -1;
    if (aDownloads !== bDownloads) return bDownloads - aDownloads;
  }
  const qualityDifference = metadataQuality(b) - metadataQuality(a);
  if (qualityDifference) return qualityDifference;
  return a.name.localeCompare(b.name, "zh-CN");
}

/**
 * Merge real API results from the discovery requests into browse cards.
 * A package found by multiple category queries is rendered once and keeps all
 * of its category memberships.
 */
export function buildSkillHubCatalog(
  batches: readonly SkillHubCatalogDiscoveryBatch[],
): SkillHubCatalogItem[] {
  const byKey = new Map<string, SkillHubCatalogItem>();

  for (const batch of batches) {
    if (!CATEGORY_ORDER.has(batch.category)) continue;
    const query = batch.query.trim();
    for (const item of normalizeSkillHubMarketItems(batch.items)) {
      const sourcedItem: SkillHubMarketItem = {
        ...item,
        origin_source: item.origin_source || batch.source,
        origin_hint: item.origin_hint || batch.hint,
      };
      const key = skillHubCatalogItemKey(sourcedItem);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          ...sourcedItem,
          catalogCategories: [batch.category],
          discoveryQueries: query ? [query] : [],
        });
        continue;
      }

      const merged = mergeMarketItem(existing, sourcedItem);
      byKey.set(key, {
        ...merged,
        catalogCategories: [...new Set([...existing.catalogCategories, batch.category])].sort(
          (a, b) => (CATEGORY_ORDER.get(a) ?? 0) - (CATEGORY_ORDER.get(b) ?? 0),
        ),
        discoveryQueries: query
          ? [...new Set([...existing.discoveryQueries, query])]
          : existing.discoveryQueries,
      });
    }
  }

  return [...byKey.values()].sort(compareCatalogItems);
}

export function filterSkillHubCatalog(
  items: readonly SkillHubCatalogItem[],
  category: SkillHubCatalogCategoryId,
): SkillHubCatalogItem[] {
  if (category === "all") return [...items];
  return items.filter((item) => item.catalogCategories.includes(category));
}

/**
 * Explicit user searches must remain API-wide. This normalizes and de-duplicates
 * the response while preserving its relevance order; it intentionally does not
 * apply catalogue category filters or discovery-query membership.
 */
export function normalizeSkillHubFullSearchResults(
  input: unknown,
  context?: { source?: string; hint?: string },
): SkillHubMarketItem[] {
  const byKey = new Map<string, SkillHubMarketItem>();
  for (const rawItem of normalizeSkillHubMarketItems(input)) {
    const item = {
      ...rawItem,
      origin_source: rawItem.origin_source || context?.source,
      origin_hint: rawItem.origin_hint || context?.hint,
    };
    const key = skillHubCatalogItemKey(item);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeMarketItem(existing, item) : item);
  }
  return [...byKey.values()];
}

async function runDiscoveryWave(
  requests: readonly SkillHubCatalogDiscoveryRequest[],
  search: (query: string) => Promise<SkillHubCatalogSearchResponse>,
): Promise<{ batches: SkillHubCatalogDiscoveryBatch[]; failedRequests: number }> {
  const batches: SkillHubCatalogDiscoveryBatch[] = [];
  let failedRequests = 0;
  const responses = await Promise.all(
    requests.map(async (request) => {
      try {
        return { request, response: await search(request.query) };
      } catch {
        return { request, response: null };
      }
    }),
  );

  for (const { request, response } of responses) {
    if (!response?.ok) {
      failedRequests += 1;
      continue;
    }
    batches.push({
      ...request,
      items: response.items,
      source: response.source,
      hint: response.hint,
    });
  }
  return { batches, failedRequests };
}

async function fetchSkillHubCatalog(
  search: (query: string) => Promise<SkillHubCatalogSearchResponse>,
): Promise<SkillHubCatalogSnapshot> {
  const primaryRequests = getSkillHubCatalogDiscoveryRequests();
  const primaryBatches: SkillHubCatalogDiscoveryBatch[] = [];
  let failedRequests = 0;

  // Two small waves keep fallback processes bounded and make the first cards
  // available without issuing every request simultaneously.
  for (let offset = 0; offset < primaryRequests.length; offset += 2) {
    const wave = await runDiscoveryWave(primaryRequests.slice(offset, offset + 2), search);
    primaryBatches.push(...wave.batches);
    failedRequests += wave.failedRequests;
  }

  const populatedCategories = new Set(
    primaryBatches
      .filter((batch) => normalizeSkillHubMarketItems(batch.items).length > 0)
      .map((batch) => batch.category),
  );
  const fallbackRequests = DISCOVERY_CATEGORIES.flatMap((category) => {
    if (populatedCategories.has(category.id)) return [];
    const query = category.queries[1];
    return query ? [{ category: category.id, query }] : [];
  });
  if (fallbackRequests.length > 0) {
    const fallback = await runDiscoveryWave(fallbackRequests, search);
    primaryBatches.push(...fallback.batches);
    failedRequests += fallback.failedRequests;
  }

  return {
    items: buildSkillHubCatalog(primaryBatches),
    failedRequests,
    hints: [
      ...new Set(
        primaryBatches
          .map((batch) => batch.hint?.trim())
          .filter((hint): hint is string => Boolean(hint)),
      ),
    ],
  };
}

/** Session-scoped catalogue cache with shared in-flight work for remounts. */
export function loadSkillHubCatalog(
  search: (query: string) => Promise<SkillHubCatalogSearchResponse>,
  options?: { force?: boolean; now?: number },
): Promise<SkillHubCatalogSnapshot> {
  const now = options?.now ?? Date.now();
  if (!options?.force && catalogCache && catalogCache.expiresAt > now) {
    return Promise.resolve(catalogCache.snapshot);
  }
  if (!options?.force && catalogInFlight) return catalogInFlight;

  const generation = ++catalogLoadGeneration;
  const promise = fetchSkillHubCatalog(search).then((snapshot) => {
    if (generation === catalogLoadGeneration) {
      catalogCache = { expiresAt: now + CATALOG_CACHE_TTL_MS, snapshot };
    }
    return snapshot;
  });
  catalogInFlight = promise;
  void promise.finally(() => {
    if (catalogInFlight === promise) catalogInFlight = null;
  });
  return promise;
}

/** Test seam; production refreshes use `force` rather than clearing state. */
export function resetSkillHubCatalogCacheForTests(): void {
  catalogCache = null;
  catalogInFlight = null;
  catalogLoadGeneration += 1;
}

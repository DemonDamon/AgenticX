import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSkillHubCatalog,
  filterSkillHubCatalog,
  getSkillHubCatalogDiscoveryRequests,
  loadSkillHubCatalog,
  normalizeSkillHubFullSearchResults,
  resetSkillHubCatalogCacheForTests,
  SKILLHUB_CATALOG_CATEGORIES,
  skillHubCatalogItemKey,
} from "./skillhub-catalog";

describe("SkillHub browse catalogue", () => {
  beforeEach(() => resetSkillHubCatalogCacheForTests());
  it("builds a small, maintainable set of real API discovery requests", () => {
    expect(getSkillHubCatalogDiscoveryRequests()).toEqual([
      { category: "finance", query: "金融" },
      { category: "documents", query: "PDF" },
      { category: "data", query: "Excel" },
      { category: "office", query: "PPT" },
    ]);
    expect(getSkillHubCatalogDiscoveryRequests({ category: "documents", queriesPerCategory: 2 })).toEqual([
      { category: "documents", query: "PDF" },
      { category: "documents", query: "文档处理" },
    ]);
    expect(SKILLHUB_CATALOG_CATEGORIES.map((category) => category.id)).toEqual([
      "all",
      "finance",
      "documents",
      "data",
      "office",
    ]);
  });

  it("normalizes API items, merges duplicate packages and keeps category membership", () => {
    const catalog = buildSkillHubCatalog([
      {
        category: "finance",
        query: "金融",
        items: [
          {
            slug: "report-reader",
            name: "财报阅读",
            description: "读取公开财务报告",
            downloads: "1.2k",
            source: "skillhub",
            source_type: "skillhub",
            namespace: "finance-lab",
            canonical_name: "@finance-lab/report-reader",
          },
          {
            slug: "market-data",
            name: "市场数据",
            downloads: 80,
          },
        ],
      },
      {
        category: "documents",
        query: "PDF",
        items: [
          {
            slug: "report-reader",
            name: "Report Reader",
            author: "Finance Lab",
            source: "skillhub",
            source_type: "skillhub",
            namespace: "finance-lab",
            canonicalName: "@finance-lab/report-reader",
          },
          {
            slug: "pdf-tools",
            name: "PDF Tools",
            downloads: "2万",
          },
        ],
      },
    ]);

    expect(catalog.map((item) => item.slug)).toEqual([
      "pdf-tools",
      "report-reader",
      "market-data",
    ]);
    expect(catalog[1]).toMatchObject({
      slug: "report-reader",
      description: "读取公开财务报告",
      author: "Finance Lab",
      catalogCategories: ["finance", "documents"],
      discoveryQueries: ["金融", "PDF"],
      provenance_source: "skillhub",
    });
  });

  it("filters only browse cards while all keeps the complete discovered set", () => {
    const catalog = buildSkillHubCatalog([
      { category: "finance", query: "金融", items: [{ slug: "finance-one" }] },
      { category: "data", query: "Excel", items: [{ slug: "data-one" }] },
    ]);

    expect(filterSkillHubCatalog(catalog, "finance").map((item) => item.slug)).toEqual([
      "finance-one",
    ]);
    expect(filterSkillHubCatalog(catalog, "all")).toHaveLength(2);
  });

  it("keeps explicit API search results independent of browse categories", () => {
    const results = normalizeSkillHubFullSearchResults([
      { slug: "unclassified-one", name: "First result" },
      { slug: "unclassified-two", name: "Second result" },
      {
        slug: "unclassified-one",
        name: "First result",
        description: "Richer duplicate metadata",
      },
    ]);

    expect(results.map((item) => item.slug)).toEqual([
      "unclassified-one",
      "unclassified-two",
    ]);
    expect(results[0].description).toBe("Richer duplicate metadata");
  });

  it("uses one slug identity across native and compatibility sources", () => {
    expect(
      skillHubCatalogItemKey({
        slug: "same-name",
        name: "Same name",
        description: "",
        version: "latest",
        author: "unknown",
        source: "skillhub",
        source_type: "skillhub",
        namespace: "publisher",
        canonical_name: "@Publisher/Same-Name",
        provenance_source: "skillhub",
      }),
    ).toBe("same-name");
  });

  it("prefers native coordinates while de-duplicating a compatibility result", () => {
    const results = buildSkillHubCatalog([
      {
        category: "finance",
        query: "金融",
        source: "clawhub_registry",
        hint: "当前结果来自兼容镜像。",
        items: [{ slug: "shared", namespace: "mirror", source_type: "clawhub" }],
      },
      {
        category: "documents",
        query: "PDF",
        source: "skillhub_api",
        items: [
          {
            slug: "shared",
            namespace: "native-publisher",
            canonical_name: "@native-publisher/shared",
            source_type: "skillhub",
            downloads: 0,
          },
        ],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      slug: "shared",
      namespace: "native-publisher",
      canonical_name: "@native-publisher/shared",
      origin_source: "skillhub_api",
      downloads: 0,
      catalogCategories: ["finance", "documents"],
    });
  });

  it("loads a fallback seed only for a category whose primary seed is empty", async () => {
    const search = vi.fn(async (query: string) => ({
      ok: true,
      source: "skillhub_api",
      items: query === "PDF" ? [] : [{ slug: `result-${query}` }],
    }));

    const snapshot = await loadSkillHubCatalog(search);

    expect(search).toHaveBeenCalledTimes(5);
    expect(search.mock.calls.map(([query]) => query)).toEqual([
      "金融",
      "PDF",
      "Excel",
      "PPT",
      "文档处理",
    ]);
    expect(snapshot.items.some((item) => item.slug === "result-文档处理")).toBe(true);
  });

  it("shares in-flight work, reuses the TTL cache, and force refreshes", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let hold = true;
    const search = vi.fn(async (query: string) => {
      if (hold) await firstGate;
      return { ok: true, source: "skillhub_api", items: [{ slug: query }] };
    });

    const firstLoad = loadSkillHubCatalog(search, { now: 100 });
    const sharedLoad = loadSkillHubCatalog(search, { now: 101 });
    expect(sharedLoad).toBe(firstLoad);
    hold = false;
    releaseFirst();
    await firstLoad;
    expect(search).toHaveBeenCalledTimes(4);

    await loadSkillHubCatalog(search, { now: 102 });
    expect(search).toHaveBeenCalledTimes(4);

    await loadSkillHubCatalog(search, { force: true, now: 103 });
    expect(search).toHaveBeenCalledTimes(8);
  });

  it("preserves response origin and hint for explicit market-wide search", () => {
    const results = normalizeSkillHubFullSearchResults(
      [{ slug: "compat-result", source_type: "clawhub" }],
      { source: "clawhub_registry", hint: "当前结果来自兼容镜像。" },
    );

    expect(results[0]).toMatchObject({
      origin_source: "clawhub_registry",
      origin_hint: "当前结果来自兼容镜像。",
    });
  });
});

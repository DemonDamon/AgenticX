import { describe, expect, it, vi } from "vitest";

import {
  createPlatformCatalogItem,
  grantPlatformCatalogToTenant,
  listPlatformCatalogItems,
  publishPlatformCatalogVersion,
  revokePlatformCatalogFromTenant,
  scanPlatformCatalogVersion,
  type PlatformCatalogFetch,
} from "../platform-catalog-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("platform-catalog-client", () => {
  it("lists catalog items", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ code: "00000", data: { items: [{ id: "c1", slug: "demo" }] } }),
    ) as PlatformCatalogFetch;
    const items = await listPlatformCatalogItems(fetch, "err");
    expect(items).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/admin/platform-catalog", { cache: "no-store" });
  });

  it("creates catalog draft", async () => {
    const fetch = vi.fn(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ slug: "demo-skill", resourceType: "skill" });
      return jsonResponse({ code: "00000", data: { item: { id: "c1", slug: "demo-skill" } } });
    }) as PlatformCatalogFetch;
    const item = await createPlatformCatalogItem(
      fetch,
      { slug: "demo-skill", resourceType: "skill" },
      "err",
    );
    expect(item.id).toBe("c1");
  });

  it("grants tenant", async () => {
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/grants");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ tenantId: "01TENANTAAAAAAAAAAAAAAAAAA" });
      return jsonResponse({ code: "00000", data: {} });
    }) as PlatformCatalogFetch;
    await grantPlatformCatalogToTenant(fetch, "cat1", "01TENANTAAAAAAAAAAAAAAAAAA", "err");
  });

  it("revokes with retain policy", async () => {
    const fetch = vi.fn(async (_url, init) => {
      expect(init?.method).toBe("DELETE");
      expect(JSON.parse(String(init?.body))).toEqual({
        tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
        policy: "retain_stop_updates",
      });
      return jsonResponse({ code: "00000", data: {} });
    }) as PlatformCatalogFetch;
    await revokePlatformCatalogFromTenant(
      fetch,
      "cat1",
      "01TENANTAAAAAAAAAAAAAAAAAA",
      "retain_stop_updates",
      "err",
    );
  });

  it("scan and publish version endpoints", async () => {
    const fetch = vi.fn(async (url, init) => {
      const path = String(url);
      if (path.endsWith("/scan")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ code: "00000", data: { version: { id: "v1", scanVerdict: "safe" } } });
      }
      if (path.endsWith("/publish")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          code: "00000",
          data: { item: { id: "c1", shelfStatus: "published" }, version: { id: "v1" } },
        });
      }
      throw new Error(`unexpected ${path}`);
    }) as PlatformCatalogFetch;
    const scanned = await scanPlatformCatalogVersion(fetch, "c1", "v1", "err");
    expect(scanned.scanVerdict).toBe("safe");
    const published = await publishPlatformCatalogVersion(fetch, "c1", "v1", "err");
    expect(published.item.shelfStatus).toBe("published");
  });
});

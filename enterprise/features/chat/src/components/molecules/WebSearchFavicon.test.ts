import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFaviconCacheForTests,
  faviconCandidatesForHost,
  loadFaviconObjectUrl,
} from "./WebSearchFavicon";

describe("faviconCandidatesForHost", () => {
  it("prefers same-origin BFF proxy first", () => {
    const urls = faviconCandidatesForHost("www.techcrunch.com");
    expect(urls[0]).toBe("/api/web-search/favicon?host=techcrunch.com&v=2");
    expect(urls.some((u) => u.includes("duckduckgo.com"))).toBe(true);
  });

  it("returns empty for blank host", () => {
    expect(faviconCandidatesForHost("")).toEqual([]);
  });
});

describe("loadFaviconObjectUrl", () => {
  const pngBytes = (() => {
    const bytes = new Uint8Array(128);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    return bytes;
  })();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetFaviconCacheForTests();
    fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => pngBytes.buffer.slice(0),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:favicon"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaviconCacheForTests();
  });

  it("issues one BFF request per host even when chips remount repeatedly", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => loadFaviconObjectUrl("wenku.baidu.com")),
    );

    expect(results.every((url) => url === "blob:favicon")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await loadFaviconObjectUrl("wenku.baidu.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps hosts isolated", async () => {
    await loadFaviconObjectUrl("wenku.baidu.com");
    await loadFaviconObjectUrl("baike.baidu.com");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

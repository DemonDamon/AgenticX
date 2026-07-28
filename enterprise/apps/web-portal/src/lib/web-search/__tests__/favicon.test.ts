import { afterEach, describe, expect, it, vi } from "vitest";
import {
  faviconFetchUrls,
  fetchFaviconBytes,
  hostVariants,
  normalizeFaviconHost,
  resetFaviconCacheForTests,
} from "../favicon";

afterEach(() => {
  resetFaviconCacheForTests();
});

describe("normalizeFaviconHost", () => {
  it("accepts public hostnames", () => {
    expect(normalizeFaviconHost("https://www.TechCrunch.com/path")).toBe("techcrunch.com");
    expect(normalizeFaviconHost("zhuanlan.zhihu.com")).toBe("zhuanlan.zhihu.com");
  });

  it("rejects localhost / private / invalid", () => {
    expect(normalizeFaviconHost("localhost")).toBeNull();
    expect(normalizeFaviconHost("127.0.0.1")).toBeNull();
    expect(normalizeFaviconHost("192.168.1.1")).toBeNull();
    expect(normalizeFaviconHost("not a host")).toBeNull();
    expect(normalizeFaviconHost("")).toBeNull();
  });
});

describe("hostVariants", () => {
  it("adds parent domain for subdomains", () => {
    expect(hostVariants("zhuanlan.zhihu.com")).toEqual(["zhuanlan.zhihu.com", "zhihu.com"]);
    expect(hostVariants("cn.bing.com")).toEqual(["cn.bing.com", "bing.com"]);
  });
});

describe("faviconFetchUrls", () => {
  it("lists ddg before google", () => {
    const urls = faviconFetchUrls("example.com");
    expect(urls[0]).toContain("duckduckgo.com");
    expect(urls.at(-1)).toContain("google.com/s2/favicons");
  });
});

describe("fetchFaviconBytes budget + cache", () => {
  it("stops within overall budget when upstreams hang", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 5_000);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "TimeoutError"));
          },
          { once: true },
        );
      });
      return new Response(new Uint8Array(32), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const started = Date.now();
    const result = await fetchFaviconBytes("csdn.net", fetchImpl as never);
    const elapsed = Date.now() - started;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(4_000);
  });

  it("dedupes in-flight + caches negative lookups", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      return new Response(null, { status: 404 });
    });
    const [a, b] = await Promise.all([
      fetchFaviconBytes("example.com", fetchImpl as never),
      fetchFaviconBytes("example.com", fetchImpl as never),
    ]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(calls).toBeLessThanOrEqual(4); // one uncached walk, not two full storms
    const before = calls;
    await fetchFaviconBytes("example.com", fetchImpl as never);
    expect(calls).toBe(before); // negative cache hit
  });
});


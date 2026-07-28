import { describe, expect, it } from "vitest";
import { faviconFetchUrls, hostVariants, normalizeFaviconHost } from "../favicon";

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


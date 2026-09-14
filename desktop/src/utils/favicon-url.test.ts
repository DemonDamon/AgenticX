import { describe, expect, it } from "vitest";
import {
  duckDuckGoFaviconUrl,
  googleFaviconUrl,
  hostVariants,
  hostnameFromUrlOrDomain,
  resolveFaviconCandidates,
  siteLabelFromUrl,
  yandexFaviconUrl,
} from "./favicon-url";

describe("favicon-url", () => {
  it("extracts hostname from full URL", () => {
    expect(hostnameFromUrlOrDomain("https://www.techcrunch.com/path?q=1")).toBe(
      "techcrunch.com",
    );
  });

  it("normalizes bare domain", () => {
    expect(hostnameFromUrlOrDomain("www.reddit.com")).toBe("reddit.com");
  });

  it("builds parent host variants for subdomains", () => {
    expect(hostVariants("data.eastmoney.com")).toEqual([
      "data.eastmoney.com",
      "eastmoney.com",
    ]);
    expect(hostVariants("money.finance.sina.com.cn")).toEqual([
      "money.finance.sina.com.cn",
      "sina.com.cn",
    ]);
  });

  it("builds ddg + yandex + google candidates (parent variants included)", () => {
    const list = resolveFaviconCandidates(
      "https://data.eastmoney.com/notices/x",
      "data.eastmoney.com",
      32,
    );
    expect(list[0]).toBe(duckDuckGoFaviconUrl("data.eastmoney.com"));
    expect(list).toContain(yandexFaviconUrl("eastmoney.com"));
    expect(list).toContain(googleFaviconUrl("eastmoney.com", 32));
  });

  it("returns empty when url/domain missing", () => {
    expect(resolveFaviconCandidates("", "")).toEqual([]);
  });
});

describe("siteLabelFromUrl", () => {
  it("uses registrable label and title-cases it", () => {
    expect(siteLabelFromUrl("https://www.venturebeat.com/ai/example")).toBe("Venturebeat");
    expect(siteLabelFromUrl("https://news.marsbit.co/flash/1")).toBe("Marsbit");
    expect(siteLabelFromUrl("https://www.kimi.com/news/x")).toBe("Kimi");
  });

  it("prefers the name before com.cn / net.cn", () => {
    expect(siteLabelFromUrl("https://www.toast.com.cn/news/x")).toBe("Toast");
    expect(siteLabelFromUrl("https://t.cj.sina.com.cn/articles/view/1")).toBe("Sina");
  });

  it("falls back to [N] when url is unusable", () => {
    expect(siteLabelFromUrl("", "", 3)).toBe("[3]");
    expect(siteLabelFromUrl(undefined, undefined, 1)).toBe("[1]");
  });
});

import { describe, expect, it } from "vitest";
import {
  duckDuckGoFaviconUrl,
  googleFaviconUrl,
  hostVariants,
  hostnameFromUrlOrDomain,
  resolveFaviconCandidates,
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

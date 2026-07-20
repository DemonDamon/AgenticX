import { describe, expect, it } from "vitest";
import {
  duckDuckGoFaviconUrl,
  googleFaviconUrl,
  hostnameFromUrlOrDomain,
  resolveFaviconCandidates,
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

  it("builds google + duckduckgo candidates", () => {
    const list = resolveFaviconCandidates(
      "https://vercel.com/docs",
      "vercel.com",
      32,
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(googleFaviconUrl("vercel.com", 32));
    expect(list[1]).toBe(duckDuckGoFaviconUrl("vercel.com"));
  });

  it("returns empty when url/domain missing", () => {
    expect(resolveFaviconCandidates("", "")).toEqual([]);
  });
});

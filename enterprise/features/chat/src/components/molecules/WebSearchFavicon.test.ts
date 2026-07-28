import { describe, expect, it } from "vitest";
import { faviconCandidatesForHost } from "./WebSearchFavicon";

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

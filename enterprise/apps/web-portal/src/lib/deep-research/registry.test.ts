import { describe, expect, it } from "vitest";
import { CitationRegistry, normalizeCitationUrl } from "./registry";

describe("CitationRegistry", () => {
  it("treats utm variants as the same source", () => {
    const registry = new CitationRegistry();
    const a = registry.add({
      title: "A",
      url: "https://example.com/x?utm_source=twitter",
      snippet: "s1",
    });
    const b = registry.add({
      title: "B",
      url: "https://example.com/x?utm_campaign=c",
      snippet: "s2",
    });
    expect(a.index).toBe(1);
    expect(b.index).toBe(1);
    expect(registry.size).toBe(1);
  });

  it("treats trailing slash as the same source", () => {
    const registry = new CitationRegistry();
    registry.add({ title: "A", url: "https://a.com/x/", snippet: "" });
    registry.add({ title: "B", url: "https://a.com/x", snippet: "" });
    expect(registry.size).toBe(1);
    expect(normalizeCitationUrl("https://a.com/x/")).toBe(normalizeCitationUrl("https://a.com/x"));
  });

  it("keeps a publication date discovered by a later duplicate hit", () => {
    const registry = new CitationRegistry();
    registry.add({ title: "A", url: "https://a.com/x", snippet: "" });
    registry.add({
      title: "A dated",
      url: "https://a.com/x#later",
      snippet: "",
      publishedAt: "2026-08-10",
    });
    expect(registry.list()[0]?.publishedAt).toBe("2026-08-10");
  });

  it("assigns contiguous indexes", () => {
    const registry = new CitationRegistry();
    registry.add({ title: "1", url: "https://a.com/1", snippet: "" });
    registry.add({ title: "2", url: "https://a.com/2", snippet: "" });
    registry.add({ title: "3", url: "https://a.com/3", snippet: "" });
    expect(registry.list().map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it("attachFullText matches normalized URL and ignores unknown urls", () => {
    const registry = new CitationRegistry();
    registry.add({
      title: "A",
      url: "https://a.com/x?utm_source=y",
      snippet: "s",
    });
    registry.attachFullText("https://a.com/x", "全文正文");
    expect(registry.list()[0]?.fullText).toBe("全文正文");
    expect(() => registry.attachFullText("https://missing.com", "x")).not.toThrow();
  });
});

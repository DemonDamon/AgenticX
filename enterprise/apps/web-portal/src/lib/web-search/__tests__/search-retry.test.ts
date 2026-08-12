import { describe, expect, it } from "vitest";
import type { WebSearchHit, WebSearchProviderConfig } from "../providers";
import {
  assessSearchEvidence,
  interleaveSearchHitGroups,
  mergeSearchHits,
  selectAlternativeProvider,
} from "../search-retry";

function hit(url: string): WebSearchHit {
  return { title: url, url, snippet: "snippet" };
}

function provider(id: string, priority: number): WebSearchProviderConfig {
  return {
    id,
    adapter: "test-adapter",
    displayName: id,
    apiKey: "key",
    enabled: true,
    priority,
  };
}

describe("cost-bounded ordinary-search retry policy", () => {
  it("allows a complement only for at most two URLs from one host", () => {
    expect(
      assessSearchEvidence([
        hit("https://docs.example.com/a"),
        hit("https://docs.example.com/b"),
      ]),
    ).toMatchObject({ retry: true, uniqueUrls: 2, uniqueHosts: 1 });
  });

  it("does not retry two results from different hosts", () => {
    expect(
      assessSearchEvidence([
        hit("https://one.example/a"),
        hit("https://two.example/b"),
      ]).retry,
    ).toBe(false);
  });

  it("does not retry three results even when they share one host", () => {
    expect(
      assessSearchEvidence([
        hit("https://docs.example/a"),
        hit("https://docs.example/b"),
        hit("https://docs.example/c"),
      ]).retry,
    ).toBe(false);
  });

  it("selects a different configured provider by id without vendor knowledge", () => {
    expect(
      selectAlternativeProvider(
        [provider("tenant-search-a", 0), provider("tenant-search-b", 1)],
        "tenant-search-a",
      )?.id,
    ).toBe("tenant-search-b");
  });

  it("prefers a different adapter over another instance of the same adapter", () => {
    const providers = [
      provider("primary", 0),
      provider("same-adapter", 1),
      { ...provider("different-adapter", 2), adapter: "other-test-adapter" },
    ];
    expect(selectAlternativeProvider(providers, "primary")?.id).toBe(
      "different-adapter",
    );
  });

  it("returns no alternative for a single configured provider", () => {
    expect(
      selectAlternativeProvider([provider("only-provider", 0)], "only-provider"),
    ).toBeNull();
  });

  it("keeps primary ordering while removing duplicate complement URLs", () => {
    const merged = mergeSearchHits(
      [hit("https://example.com/a#primary")],
      [hit("https://example.com/a"), hit("https://other.example/b")],
    );
    expect(merged.map((item) => item.url)).toEqual([
      "https://example.com/a#primary",
      "https://other.example/b",
    ]);
  });

  it("interleaves independently ranked facets and removes cross-facet duplicates", () => {
    const merged = interleaveSearchHitGroups([
      [hit("https://wang.example/1"), hit("https://shared.example/item")],
      [hit("https://deng.example/1"), hit("https://shared.example/item")],
    ]);
    expect(merged.map((item) => item.url)).toEqual([
      "https://wang.example/1",
      "https://deng.example/1",
      "https://shared.example/item",
    ]);
  });
});

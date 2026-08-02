import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_TOKENS,
  MIN_SELECTED_HITS,
  WEB_SEARCH_SNIPPET_CHARS,
  resolveInjectionBudgetChars,
  resolveModelContextTokens,
  selectHitsWithinBudget,
} from "../context-budget";
import type { WebSearchHit } from "../providers";

describe("resolveModelContextTokens", () => {
  it("maps explicit k suffixes and family heuristics", () => {
    expect(resolveModelContextTokens("moonshot-v1-32k")).toBe(32_000);
    expect(resolveModelContextTokens("glm-5.2")).toBe(128_000);
    expect(resolveModelContextTokens("deepseek-chat")).toBe(64_000);
    expect(resolveModelContextTokens("unknown-model")).toBe(DEFAULT_CONTEXT_TOKENS);
  });

  it("strips provider prefix defensively", () => {
    expect(resolveModelContextTokens("caixun/glm-5.2")).toBe(128_000);
  });
});

describe("resolveInjectionBudgetChars", () => {
  afterEach(() => {
    delete process.env.WEB_SEARCH_CONTEXT_BUDGET_CHARS;
  });

  it("gives 128k-class models a budget far above the old 3200 cap", () => {
    const budget = resolveInjectionBudgetChars("glm-5.2");
    expect(budget).toBeGreaterThanOrEqual(24_000);
    expect(budget).toBeGreaterThan(3_200);
  });

  it("honors WEB_SEARCH_CONTEXT_BUDGET_CHARS override", () => {
    process.env.WEB_SEARCH_CONTEXT_BUDGET_CHARS = "5000";
    expect(resolveInjectionBudgetChars("glm-5.2")).toBe(5_000);
  });
});

describe("selectHitsWithinBudget", () => {
  afterEach(() => {
    delete process.env.WEB_SEARCH_CONTEXT_BUDGET_CHARS;
  });

  function makeHits(n: number, snippetLen = WEB_SEARCH_SNIPPET_CHARS): WebSearchHit[] {
    const snippet = "字".repeat(snippetLen);
    return Array.from({ length: n }, (_, i) => ({
      title: `Hit ${i + 1}`,
      url: `https://ex.com/${i + 1}`,
      snippet,
    }));
  }

  it("selects many more than 10 hits for 128k models", () => {
    const hits = makeHits(50, 480);
    const { selected, remainder } = selectHitsWithinBudget(hits, "glm-5.2");
    expect(selected.length).toBeGreaterThanOrEqual(30);
    expect(selected.length + remainder.length).toBe(hits.length);
  });

  it("selects fewer hits for default 32k models but at least MIN_SELECTED_HITS", () => {
    const hits = makeHits(50, 480);
    const big = selectHitsWithinBudget(hits, "glm-5.2");
    const small = selectHitsWithinBudget(hits, "unknown-model");
    expect(small.selected.length).toBeLessThan(big.selected.length);
    expect(small.selected.length).toBeGreaterThanOrEqual(MIN_SELECTED_HITS);
    expect(small.selected.length + small.remainder.length).toBe(hits.length);
  });

  it("truncates selected snippets", () => {
    const hits = makeHits(3, 900);
    const { selected } = selectHitsWithinBudget(hits, "glm-5.2");
    for (const hit of selected) {
      expect(hit.snippet.length).toBeLessThanOrEqual(WEB_SEARCH_SNIPPET_CHARS);
    }
  });
});

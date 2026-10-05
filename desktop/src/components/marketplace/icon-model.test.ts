import { describe, expect, it } from "vitest";
import {
  MARKET_GRADIENTS,
  hashName,
  pickGradientFor,
  pickMarketIconGlyph,
} from "./icon-model";

describe("hashName", () => {
  it("is deterministic for the same input", () => {
    expect(hashName("decidealot")).toBe(hashName("decidealot"));
  });

  it("differs for different inputs", () => {
    const values = new Set(["officecli", "archscribe", "decidealot", "github"].map(hashName));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("pickGradientFor", () => {
  it("returns a stable gradient from the palette", () => {
    const g = pickGradientFor("高德地图");
    expect(MARKET_GRADIENTS).toContain(g);
    expect(pickGradientFor("高德地图")).toBe(g);
  });

  it("spreads different names across multiple gradients", () => {
    const names = Array.from({ length: 24 }, (_, i) => `plugin-${i}`);
    const picked = new Set(names.map(pickGradientFor));
    expect(picked.size).toBeGreaterThanOrEqual(4);
  });
});

describe("pickMarketIconGlyph", () => {
  it("maps Chinese keyword names to industry glyphs", () => {
    expect(pickMarketIconGlyph("高德地图 MCP")).toBe("map");
    expect(pickMarketIconGlyph("必应搜索中文")).toBe("search");
    expect(pickMarketIconGlyph("视觉图片生成")).toBe("image");
    expect(pickMarketIconGlyph("前端设计工具集")).toBe("code");
  });

  it("maps English keyword names case-insensitively", () => {
    expect(pickMarketIconGlyph("GitHub MCP Server")).toBe("git");
    expect(pickMarketIconGlyph("Fetch网页内容抓取")).toBe("search");
    expect(pickMarketIconGlyph("Chrome DevTools")).toBe("globe");
  });

  it("falls back to sparkles when no keyword matches", () => {
    expect(pickMarketIconGlyph("decidealot")).toBe("sparkles");
  });
});

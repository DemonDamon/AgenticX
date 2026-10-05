import { describe, expect, it } from "vitest";
import {
  MARKET_GRADIENTS,
  hashName,
  pickBrandIcon,
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

describe("pickBrandIcon", () => {
  it("matches known brand names (case-insensitively)", () => {
    expect(pickBrandIcon("supabase")).toEqual({ brand: "supabase" });
    expect(pickBrandIcon("Supabase 数据库")).toEqual({ brand: "supabase" });
    expect(pickBrandIcon("GitHub MCP Server")).toEqual({ brand: "github" });
    expect(pickBrandIcon("claude-code")).toEqual({ brand: "anthropic" });
    expect(pickBrandIcon("postgres 查询工具")).toEqual({ brand: "postgresql" });
  });

  it("matches Chinese brand names", () => {
    expect(pickBrandIcon("阿里云百炼")).toEqual({ brand: "alibabacloud" });
    expect(pickBrandIcon("微信公众号助手")).toEqual({ brand: "wechat" });
  });

  it("matches CN service brands by Chinese or English keywords", () => {
    expect(pickBrandIcon("博查搜索")).toEqual({ brand: "bocha" });
    expect(pickBrandIcon("bocha-search-mcp")).toEqual({ brand: "bocha" });
    expect(pickBrandIcon("feishu-mcp")).toEqual({ brand: "feishu" });
    expect(pickBrandIcon("lark-mcp")).toEqual({ brand: "feishu" });
    expect(pickBrandIcon("智谱联网搜索")).toEqual({ brand: "zhipu" });
    expect(pickBrandIcon("chatglm")).toEqual({ brand: "zhipu" });
    expect(pickBrandIcon("通义千问")).toEqual({ brand: "qwen" });
    expect(pickBrandIcon("kimi").brand).toBe("kimi");
    expect(pickBrandIcon("moonshot-mcp")).toEqual({ brand: "kimi" });
    expect(pickBrandIcon("豆包")).toEqual({ brand: "doubao" });
    expect(pickBrandIcon("腾讯会议")).toEqual({ brand: "tencent" });
    expect(pickBrandIcon("百度地图")).toEqual({ brand: "baidu" });
    expect(pickBrandIcon("知乎热榜")).toEqual({ brand: "zhihu" });
    expect(pickBrandIcon("哔哩哔哩")).toEqual({ brand: "bilibili" });
    expect(pickBrandIcon("小红书笔记")).toEqual({ brand: "xiaohongshu" });
    expect(pickBrandIcon("美团外卖")).toEqual({ brand: "meituan" });
    expect(pickBrandIcon("metaso-search")).toEqual({ brand: "metaso" });
    expect(pickBrandIcon("秘塔AI搜索")).toEqual({ brand: "metaso" });
    expect(pickBrandIcon("mineru-docparser")).toEqual({ brand: "mineru" });
  });

  it("returns null for unknown names", () => {
    expect(pickBrandIcon("decidealot")).toBeNull();
    expect(pickBrandIcon("12306-mcp")).toBeNull();
    expect(pickBrandIcon("xiniudata")).toBeNull();
  });
});

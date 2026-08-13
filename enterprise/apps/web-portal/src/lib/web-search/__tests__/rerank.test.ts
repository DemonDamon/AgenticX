import { describe, expect, it } from "vitest";
import type { WebSearchHit } from "../providers";
import { rankTextPassages, rerankHits, tokenize } from "../rerank";

function hit(title: string, url: string, snippet = ""): WebSearchHit {
  return { title, url, snippet };
}

describe("tokenize", () => {
  it("splits CJK into bigrams and ASCII into lowercase words", () => {
    expect(tokenize("广州南沙天气")).toEqual(["广州", "州南", "南沙", "沙天", "天气"]);
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
    expect(tokenize("广州 Nansha 天气")).toContain("广州");
    expect(tokenize("广州 Nansha 天气")).toContain("nansha");
  });

  it("expands compact letter-number identifiers without a domain keyword list", () => {
    expect(tokenize("Figure11")).toEqual(["figure11", "figure", "11"]);
    expect(tokenize("abc123def")).toEqual(["abc123def", "abc", "123", "def"]);
    expect(tokenize("2026")).toEqual(["2026"]);
  });

  it("adds the same compact alias to a spaced identifier", () => {
    expect(tokenize("Figure 11")).toEqual(["figure", "figure11", "11"]);
    expect(tokenize("RFC-9110")).toEqual(["rfc", "rfc9110", "9110"]);
    expect(tokenize("Figure\n11")).not.toContain("figure11");
  });
});

describe("rerankHits", () => {
  it("promotes weather-related hits that were buried at the end", () => {
    const hits: WebSearchHit[] = [
      hit("南沙区政府官网", "https://ex.com/gov", "政务公开 办事指南"),
      hit("南沙百科", "https://ex.com/wiki", "行政区划与历史沿革"),
      hit("南沙旅游攻略", "https://ex.com/travel", "景点推荐与门票"),
      hit("南沙楼市", "https://ex.com/house", "房价走势与成交"),
      hit("南沙交通", "https://ex.com/traffic", "地铁公交线路"),
      hit("南沙教育", "https://ex.com/edu", "中小学招生"),
      hit("南沙美食", "https://ex.com/food", "海鲜餐厅推荐"),
      hit("南沙招聘", "https://ex.com/jobs", "企业岗位信息"),
      hit("南沙新闻", "https://ex.com/news", "本地时政动态"),
      hit("广州南沙今日天气", "https://ex.com/weather-today", "南沙区今天中雨 气温29/23℃ 湿度偏高"),
      hit("南沙天气预报一周", "https://ex.com/weather-week", "未来七天南沙天气 气温 风力 降水"),
      hit("南沙实时气象", "https://ex.com/weather-live", "南沙天气实况 温度 湿度 风力等级"),
    ];

    const ranked = rerankHits("广州南沙天气", hits);
    const top5Urls = ranked.slice(0, 5).map((h) => h.url);
    expect(top5Urls).toEqual(
      expect.arrayContaining([
        "https://ex.com/weather-today",
        "https://ex.com/weather-week",
        "https://ex.com/weather-live",
      ]),
    );
    const weatherInTop5 = top5Urls.filter((u) => u.includes("weather")).length;
    expect(weatherInTop5).toBeGreaterThanOrEqual(3);
  });

  it("returns a copy unchanged when query is empty", () => {
    const hits = [hit("A", "https://a.com"), hit("B", "https://b.com")];
    const ranked = rerankHits("", hits);
    expect(ranked).toEqual(hits);
    expect(ranked).not.toBe(hits);
  });

  it("keeps provider order on equal BM25 scores", () => {
    const hits = [
      hit("完全无关甲", "https://a.com", "香蕉苹果"),
      hit("完全无关乙", "https://b.com", "香蕉苹果"),
      hit("完全无关丙", "https://c.com", "香蕉苹果"),
    ];
    const ranked = rerankHits("南沙天气", hits);
    expect(ranked.map((h) => h.url)).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });
});

describe("rankTextPassages", () => {
  it("uses the same lexical scorer for arbitrary document passages", () => {
    const ranked = rankTextPassages("Table 8 Pass Rate", [
      "Introduction and motivation",
      "Table 8 R&D coding benchmark",
      "Pass Rate 80 percent",
    ]);
    expect(ranked.slice(0, 2).map((row) => row.text)).toEqual(
      expect.arrayContaining([
        "Table 8 R&D coding benchmark",
        "Pass Rate 80 percent",
      ]),
    );
  });

  it("matches a compact identifier against a spaced document label", () => {
    const ranked = rankTextPassages("figure11", [
      "11 11 11 unrelated numeric results",
      "Figure 11: Win-rate comparison across analysis and editing tasks.",
    ]);
    expect(ranked[0]?.text).toContain("Figure 11: Win-rate comparison");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});

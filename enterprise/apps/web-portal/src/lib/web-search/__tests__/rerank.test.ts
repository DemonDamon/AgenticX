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

describe("rerankHits recency", () => {
  const NOW = Date.parse("2026-08-16T00:00:00Z");
  const dated = (
    title: string,
    url: string,
    snippet: string,
    publishedAt?: string,
  ): WebSearchHit => ({ title, url, snippet, ...(publishedAt ? { publishedAt } : {}) });
  const order = (query: string, hits: WebSearchHit[]) =>
    rerankHits(query, hits, NOW).map((h) => h.url);

  it("does nothing when fewer than two hits carry a date", () => {
    // Two of the four adapters in use report no dates at all; those turns must
    // rank exactly as they did before this signal existed.
    const hits = [
      hit("AppLovin 股价 行情", "https://a.example", "股价 348"),
      hit("AppLovin 股价 走势", "https://b.example", "股价 312"),
      hit("AppLovin 公司简介", "https://c.example", "公司简介"),
    ];
    const baseline = order("AppLovin 股价", hits);
    const oneDate = [
      dated("AppLovin 股价 行情", "https://a.example", "股价 348", "2020-01-01"),
      hits[1]!,
      hits[2]!,
    ];
    expect(order("AppLovin 股价", oneDate)).toEqual(baseline);
  });

  it("lifts a fresher page over one held on top by provider order alone", () => {
    // The observed shape: a quote page the provider listed first carries a
    // stale figure, while a slightly more relevant page listed further down
    // carries the current one. Their fused scores differ by well under a
    // thousandth, which is exactly the margin this signal is meant to settle.
    const stale = "https://stale.example";
    const fresh = "https://fresh.example";
    const build = (withDates: boolean) => [
      dated(
        "Applovin(APP) 股价 报价 图表",
        stale,
        "收盘价 08/07 实时股价 时间 08/10 价格 348.580",
        withDates ? "2026-08-07" : undefined,
      ),
      hit("AppLovin 公司简介", "https://c.example", "公司业务介绍"),
      hit("AppLovin 财报日期", "https://d.example", "财报披露安排"),
      dated(
        "AppLovin (APP) 今日股价 实时走势图 报价",
        fresh,
        "今日股价 实时走势 312.67 收盘时 08/13 报价",
        withDates ? "2026-08-13" : undefined,
      ),
    ];
    expect(order("AppLovin 股价 实时 报价", build(false))[0]).toBe(stale);
    expect(order("AppLovin 股价 实时 报价", build(true))[0]).toBe(fresh);
  });

  it("does not let a recent loosely related page displace a clearly relevant older one", () => {
    // What keeps a question about a major past event on its authoritative
    // sources. Recency is worth at most half of BM25 by construction, so it
    // settles near-ties and cannot overturn a real relevance gap.
    const authoritative = dated(
      "2008 金融危机 成因 深度分析",
      "https://old.example",
      "2008 金融危机 的成因、传导路径与监管失灵的完整分析",
      "2010-03-01",
    );
    const aside = dated(
      "本周市场简讯",
      "https://new.example",
      "本周市场简讯，顺带提到金融危机一词。",
      "2026-08-15",
    );
    expect(order("2008 金融危机 成因 分析", [authoritative, aside])[0]).toBe(
      "https://old.example",
    );
  });

  it("treats an unusable date exactly as if the provider had sent none", () => {
    // Provider metadata is untrusted text. Equality with the no-date ordering
    // is the property, which is what makes this independent of position.
    const base = (published?: string) => [
      dated("行情 A 报价", "https://a.example", "行情 数据 报价", "2026-08-13"),
      dated("行情 B 报价", "https://b.example", "行情 数据 报价", "2026-08-01"),
      dated("行情 C 报价", "https://c.example", "行情 数据 报价", published),
    ];
    const withoutDate = order("行情 报价", base(undefined));
    expect(order("行情 报价", base("上周三"))).toEqual(withoutDate);
    expect(order("行情 报价", base(""))).toEqual(withoutDate);
    // A page claiming next year must not be able to take the freshest slot.
    expect(order("行情 报价", base("2030-01-01"))).toEqual(withoutDate);
  });

  it("scores an undated hit as mid-range rather than oldest", () => {
    // Ranking undated hits last would quietly demote every result from the
    // providers that report no dates — a retrieval regression dressed up as a
    // freshness improvement.
    const withMedianDate = [
      dated("行情 A 报价", "https://a.example", "行情 数据 报价", "2026-08-15"),
      dated("行情 B 报价", "https://b.example", "行情 数据 报价", "2026-08-10"),
      dated("行情 C 报价", "https://c.example", "行情 数据 报价", "2026-08-05"),
    ];
    const undatedMiddle = [
      withMedianDate[0]!,
      dated("行情 B 报价", "https://b.example", "行情 数据 报价"),
      withMedianDate[2]!,
    ];
    expect(order("行情 报价", undatedMiddle)).toEqual(order("行情 报价", withMedianDate));
  });
});

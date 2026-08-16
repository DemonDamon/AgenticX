import { describe, expect, it } from "vitest";
import {
  buildSearchQueryRewriteMessages,
  canSafelyFallbackToCurrentQuery,
  hasPriorSearchQueryLeakage,
  normalizeSelfContainedSearchQueries,
  parseSearchQueryRewrite,
  parseSearchQueryRewriteValue,
  selfContainedSearchPlanInstruction,
} from "../follow-up";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

describe("contextual search-query rewrite", () => {
  it("carries the calculation hint without letting it affect the rewrite", () => {
    // The field is advisory. A value the schema does not recognise must not
    // cost the rewrite — losing that would turn a cosmetic model slip into a
    // failed search.
    expect(
      parseSearchQueryRewriteValue({
        need_search: true,
        resolved_query: "某公司 2026 上半年 营收 净利润",
        search_queries: ["某公司 2026 上半年 营收 净利润"],
        confidence: 0.95,
        calculation_intent: "needed",
      })?.calculationIntent,
    ).toBe("needed");

    for (const calculation_intent of ["NEEDED", true, 1, null, undefined]) {
      const parsed = parseSearchQueryRewriteValue({
        need_search: true,
        resolved_query: "某公司 2026 上半年 营收",
        search_queries: ["某公司 2026 上半年 营收"],
        confidence: 0.95,
        calculation_intent,
      });
      expect(parsed?.query).toBe("某公司 2026 上半年 营收");
      expect(parsed?.calculationIntent).toBe("uncertain");
    }
  });

  it("sends bounded recent context and the current query to the rewrite agent", () => {
    const messages = buildSearchQueryRewriteMessages(
      [
        { role: "user", content: "王虹到底解决了什么数学难题" },
        {
          role: "assistant",
          content: `${THINK_OPEN}内部推理${THINK_CLOSE}数学家王虹研究三维挂谷猜想。[8]`,
        },
        { role: "user", content: "搜一下这几天关于她的新闻" },
      ],
      new Date(2026, 7, 12, 9, 30, 0),
    );

    expect(messages?.[0]?.content).toContain("最近几条对话");
    expect(messages?.[0]?.content).toContain(
      "数学家 王虹 截至 2026-08-12 最近几天 新闻",
    );
    expect(messages?.[0]?.content).toContain("不得擅自假定具体天数");
    expect(messages?.[0]?.content).toContain("不要携带请求搜索或查找的操作指令");
    expect(messages?.[0]?.content).toContain("search_queries");
    expect(messages?.[0]?.content).toContain("默认只给 1 条");
    expect(messages?.[1]?.content).toContain(
      '"temporal_context":{"current_date":"2026-08-12"',
    );
    expect(messages?.[1]?.content).toContain(
      '"current_query":"搜一下这几天关于她的新闻"',
    );
    expect(messages?.[1]?.content).toContain("数学家王虹研究三维挂谷猜想");
    expect(messages?.[1]?.content).not.toContain("内部推理");
    expect(messages?.[1]?.content).not.toContain("[8]");
  });

  it("does not add a rewrite model call on the first user turn", () => {
    expect(
      buildSearchQueryRewriteMessages([
        { role: "system", content: "system" },
        { role: "user", content: "广州南沙天气如何" },
      ]),
    ).toBeNull();
  });

  it("tells the planner the configured per-turn search limit", () => {
    const conversation = [
      { role: "user", content: "甲乙丙最近分别发生了什么" },
      { role: "assistant", content: "你想继续了解这三个人。" },
      { role: "user", content: "分别查一下他们的近况" },
    ];
    const messages = buildSearchQueryRewriteMessages(
      conversation,
      new Date(2026, 7, 13, 9, 30, 0),
      2,
    );

    expect(messages?.[0]?.content).toContain("1 到 2 条可直接检索查询");
    expect(messages?.[0]?.content).not.toContain("1 到 3 条可直接检索查询");

    const single = buildSearchQueryRewriteMessages(
      conversation,
      new Date(2026, 7, 13, 9, 30, 0),
      1,
    );
    expect(single?.[0]?.content).toContain("合并进唯一一条自包含查询");
    expect(single?.[0]?.content).toContain("不得遗漏任何检索目标");
    expect(single?.[0]?.content).toContain("王虹 邓煜 分别离开北京大学 原因");
    expect(single?.[0]?.content).not.toContain("search_queries 应分别查询");
  });

  it("shares one self-contained facet contract with refinement callers", () => {
    expect(selfContainedSearchPlanInstruction(3, "queries")).toContain(
      "每条 queries 都必须自包含",
    );
    expect(
      normalizeSelfContainedSearchQueries({
        resolvedQuery: "模型 A 在两项评测中的表现",
        candidates: [
          "模型 A 基准 X 成绩",
          " 模型 A 基准 X 成绩 ",
          "模型 A 基准 Y 成绩",
          "模型 A 推理条件",
          "超出上限",
        ],
        maxSearchCalls: 3,
      }),
    ).toEqual([
      "模型 A 基准 X 成绩",
      "模型 A 基准 Y 成绩",
      "模型 A 推理条件",
    ]);
    expect(
      normalizeSelfContainedSearchQueries({
        resolvedQuery: "模型 A 在两项评测中的表现",
        candidates: ["模型 A 基准 X 成绩", "模型 A 基准 Y 成绩"],
        maxSearchCalls: 1,
      }),
    ).toEqual(["模型 A 在两项评测中的表现"]);
  });

  it("reuses the query planner for document-language lexical facets", () => {
    const messages = buildSearchQueryRewriteMessages(
      [
        { role: "user", content: "https://example.com/paper 读一下" },
        { role: "assistant", content: "已读取摘要。" },
        { role: "user", content: "我想了解注意力机制和评测数据" },
      ],
      new Date(2026, 7, 13, 9, 30, 0),
      3,
      {
        targetDocument: {
          title: "Efficient Long Context Models",
          url: "https://example.com/paper",
          sample: "Abstract: We introduce a hybrid attention mechanism.",
        },
      },
    );

    expect(messages?.[0]?.content).toContain("target_document 原文内部的词法选段");
    expect(messages?.[0]?.content).toContain("search_queries 应使用最可能实际出现在原文中的语言");
    expect(messages?.[1]?.content).toContain('"target_document"');
    expect(messages?.[1]?.content).toContain("hybrid attention mechanism");
  });

  it("extracts text from multimodal turns without leaking image payloads", () => {
    const messages = buildSearchQueryRewriteMessages([
      { role: "user", content: "比较王虹和邓煜的经历" },
      { role: "assistant", content: "上一轮回答" },
      {
        role: "user",
        content: [
          { type: "text", text: "他们最近的风评有什么变化" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ],
      },
    ]);

    expect(messages?.[1]?.content).toContain(
      '"current_query":"他们最近的风评有什么变化"',
    );
    expect(messages?.[1]?.content).not.toContain("base64");
  });

  it("does not reuse an older query for an image-only latest turn", () => {
    expect(
      buildSearchQueryRewriteMessages([
        { role: "user", content: "不要再次搜索这个旧问题" },
        { role: "assistant", content: "上一轮回答" },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
      ]),
    ).toBeNull();
  });

  it("does not reinterpret an attachment-only filename as a follow-up query", () => {
    expect(
      buildSearchQueryRewriteMessages([
        { role: "user", content: "搜索这个旧问题" },
        { role: "assistant", content: "上一轮回答" },
        {
          role: "user",
          content: "--- 附件: 行业报告.pdf ---\n文件正文",
        },
      ]),
    ).toBeNull();
  });

  it("accepts valid agent output without applying pronoun word-list semantics", () => {
    expect(
      parseSearchQueryRewrite(
        '{"resolved_query":"数学家 王虹 最近几天 新闻","confidence":0.96}',
      ),
    ).toEqual({
      query: "数学家 王虹 最近几天 新闻",
      needSearch: true,
      searchQueries: ["数学家 王虹 最近几天 新闻"],
      confidence: 0.96,
      calculationIntent: "uncertain",
    });
    expect(
      parseSearchQueryRewrite(
        '```json\n{"resolved_query":"广州南沙 天气","confidence":0.91}\n```',
      ),
    ).toEqual({
      query: "广州南沙 天气",
      needSearch: true,
      searchQueries: ["广州南沙 天气"],
      confidence: 0.91,
      calculationIntent: "uncertain",
    });
    expect(
      parseSearchQueryRewrite(
        '{"resolved_query":"她最近怎么样","confidence":0.96}',
      ),
    ).toEqual({
      query: "她最近怎么样",
      needSearch: true,
      searchQueries: ["她最近怎么样"],
      confidence: 0.96,
      calculationIntent: "uncertain",
    });
  });

  it("accepts a bounded multi-entity retrieval plan", () => {
    expect(
      parseSearchQueryRewrite(
        JSON.stringify({
          need_search: true,
          resolved_query: "王虹和邓煜为什么分别离开北京大学",
          search_queries: [
            "王虹 离开北京大学 原因",
            "邓煜 离开北京大学 原因",
            "邓煜 离开北京大学 原因",
            "第三个独立检索面",
            "超出上限不应保留",
          ],
          confidence: 0.98,
        }),
      ),
    ).toEqual({
      query: "王虹和邓煜为什么分别离开北京大学",
      needSearch: true,
      searchQueries: [
        "王虹 离开北京大学 原因",
        "邓煜 离开北京大学 原因",
        "第三个独立检索面",
      ],
      confidence: 0.98,
      calculationIntent: "uncertain",
    });
  });

  it("caps and deduplicates facets with the configured shared search budget", () => {
    const raw = JSON.stringify({
      need_search: true,
      resolved_query: "甲乙丙丁分别发生了什么",
      search_queries: ["甲 近况", "甲 近况", "乙 近况", "丙 近况", "丁 近况"],
      confidence: 0.98,
      calculationIntent: "uncertain",
    });

    expect(parseSearchQueryRewrite(raw, 2)?.searchQueries).toEqual([
      "甲 近况",
      "乙 近况",
    ]);
    expect(parseSearchQueryRewrite(raw, 1)?.searchQueries).toEqual([
      "甲乙丙丁分别发生了什么",
    ]);
    expect(parseSearchQueryRewrite(raw, 5)?.searchQueries).toEqual([
      "甲 近况",
      "乙 近况",
      "丙 近况",
      "丁 近况",
    ]);
    // Runtime corruption never widens the paid-call budget.
    expect(parseSearchQueryRewrite(raw, 99)?.searchQueries).toEqual([
      "甲 近况",
      "乙 近况",
      "丙 近况",
    ]);
  });

  it("accepts a semantic no-search decision without adding regex rules", () => {
    expect(
      parseSearchQueryRewrite(
        '{"need_search":false,"resolved_query":"1+1 等于几","search_queries":[],"confidence":0.99}',
      ),
    ).toEqual({
      query: "1+1 等于几",
      needSearch: false,
      searchQueries: [],
      confidence: 0.99,
      calculationIntent: "uncertain",
    });
  });

  it("extracts the JSON contract from reasoning wrappers and surrounding prose", () => {
    expect(
      parseSearchQueryRewrite(
        '<think>先消解主语</think>\n```json\n{"resolved_query":"数学家 王虹 最近几天 新闻","confidence":0.97}\n```',
      ),
    ).toMatchObject({ query: "数学家 王虹 最近几天 新闻", confidence: 0.97 });
    expect(
      parseSearchQueryRewrite(
        '结果如下：{"resolved_query":"王虹 近期新闻","confidence":0.9}。',
      ),
    ).toMatchObject({ query: "王虹 近期新闻", confidence: 0.9 });
  });

  it("accepts an explicit unresolved decision and rejects malformed confidence", () => {
    expect(
      parseSearchQueryRewrite('{"resolved_query":"","confidence":0}'),
    ).toEqual({
      query: "",
      needSearch: false,
      searchQueries: [],
      confidence: 0,
      calculationIntent: "uncertain",
    });
    expect(
      parseSearchQueryRewrite('{"resolved_query":"","confidence":0.9}'),
    ).toBeNull();
    expect(
      parseSearchQueryRewrite(
        '{"resolved_query":"王虹 最近怎么样","confidence":0.5}',
      ),
    ).toBeNull();
    expect(
      parseSearchQueryRewrite(
        '{"resolved_query":"王虹 最近怎么样","confidence":2}',
      ),
    ).toBeNull();
  });

  it("rejects a rewrite that copies the complete prior question", () => {
    const messages = [
      { role: "user", content: "王虹是谁" },
      { role: "assistant", content: "王虹是一位研究员。" },
      { role: "user", content: "她最近怎么样" },
    ];
    expect(hasPriorSearchQueryLeakage("王虹是谁 最近怎么样", messages)).toBe(true);
    expect(hasPriorSearchQueryLeakage("王虹 最近怎么样", messages)).toBe(false);
  });
});

describe("canSafelyFallbackToCurrentQuery", () => {
  it("refuses anything carrying anaphora, however long", () => {
    for (const query of [
      "她最近发表的那篇论文有什么新结论",
      "他们在 2026 年的 GPT-4o 部署结果如何",
      "这篇文章提到的 H100 集群规模是多少",
      "上述方案和前者相比有什么优势",
      "再查一下 DeepSeek-V3 的定价",
      "刚才说的那个版本什么时候发布",
      "what did they publish about GPT-4o last month",
      "tell me more about it",
    ]) {
      expect(canSafelyFallbackToCurrentQuery(query)).toBe(false);
    }
  });

  it("refuses a long but subject-less question", () => {
    expect(
      canSafelyFallbackToCurrentQuery(
        "请详细说明一下最近几个月里业界普遍关注的那些变化以及可能带来的长期影响和风险",
      ),
    ).toBe(false);
  });

  it("accepts a question that names its own subject", () => {
    for (const query of [
      "DeepSeek-V3 在 2026 年 3 月的定价是多少",
      "MiniMax M2 的上下文窗口有多大",
      "https://example.com/paper 讲了什么",
      "arXiv:2401.12345 的主要结论",
      "doi 10.1038/s41586-024-07123-4 的实验设计",
      "《三体》英文版销量数据",
      "H100 与 H200 的显存带宽差异",
    ]) {
      expect(canSafelyFallbackToCurrentQuery(query)).toBe(true);
    }
  });

  it("refuses an empty or purely generic query", () => {
    expect(canSafelyFallbackToCurrentQuery("")).toBe(false);
    expect(canSafelyFallbackToCurrentQuery("   ")).toBe(false);
    expect(canSafelyFallbackToCurrentQuery("最新进展")).toBe(false);
    expect(canSafelyFallbackToCurrentQuery("2026 年的情况")).toBe(false);
  });
});

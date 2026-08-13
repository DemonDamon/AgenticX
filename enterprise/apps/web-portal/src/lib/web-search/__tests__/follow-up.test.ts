import { describe, expect, it } from "vitest";
import {
  buildSearchQueryRewriteMessages,
  hasPriorSearchQueryLeakage,
  parseSearchQueryRewrite,
} from "../follow-up";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

describe("contextual search-query rewrite", () => {
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
    });
  });

  it("caps and deduplicates facets with the configured shared search budget", () => {
    const raw = JSON.stringify({
      need_search: true,
      resolved_query: "甲乙丙丁分别发生了什么",
      search_queries: ["甲 近况", "甲 近况", "乙 近况", "丙 近况", "丁 近况"],
      confidence: 0.98,
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
    ).toEqual({ query: "", needSearch: false, searchQueries: [], confidence: 0 });
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

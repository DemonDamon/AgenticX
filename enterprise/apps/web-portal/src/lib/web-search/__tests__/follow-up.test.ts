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

  it("accepts valid agent output without applying pronoun word-list semantics", () => {
    expect(
      parseSearchQueryRewrite(
        '{"resolved_query":"数学家 王虹 最近几天 新闻","confidence":0.96}',
      ),
    ).toEqual({ query: "数学家 王虹 最近几天 新闻", confidence: 0.96 });
    expect(
      parseSearchQueryRewrite(
        '```json\n{"resolved_query":"广州南沙 天气","confidence":0.91}\n```',
      ),
    ).toEqual({ query: "广州南沙 天气", confidence: 0.91 });
    expect(
      parseSearchQueryRewrite(
        '{"resolved_query":"她最近怎么样","confidence":0.96}',
      ),
    ).toEqual({ query: "她最近怎么样", confidence: 0.96 });
  });

  it("extracts the JSON contract from reasoning wrappers and surrounding prose", () => {
    expect(
      parseSearchQueryRewrite(
        '<think>先消解主语</think>\n```json\n{"resolved_query":"数学家 王虹 最近几天 新闻","confidence":0.97}\n```',
      ),
    ).toEqual({ query: "数学家 王虹 最近几天 新闻", confidence: 0.97 });
    expect(
      parseSearchQueryRewrite(
        '结果如下：{"resolved_query":"王虹 近期新闻","confidence":0.9}。',
      ),
    ).toEqual({ query: "王虹 近期新闻", confidence: 0.9 });
  });

  it("accepts an explicit unresolved decision and rejects malformed confidence", () => {
    expect(
      parseSearchQueryRewrite('{"resolved_query":"","confidence":0}'),
    ).toEqual({ query: "", confidence: 0 });
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

import { describe, expect, it } from "vitest";
import { normalizeRulePayload as normalizePg } from "../src/services/pg-store";
import { normalizeRulePayload as normalizeMysql } from "../src/services/mysql-store";

// SP3 compliance-moderation：category 走 payload 数据通道，
// normalizeRulePayload 重建 payload 时必须保留（pg/mysql 双实现同构验证）。

describe("normalizeRulePayload category passthrough", () => {
  const cases: Array<[string, "keyword" | "regex" | "pii", Record<string, unknown>, Record<string, unknown>]> = [
    [
      "keyword 保留 category",
      "keyword",
      { keywords: ["裸聊"], category: "porn" },
      { keywords: ["裸聊"], category: "porn" },
    ],
    [
      "regex 保留 category",
      "regex",
      { pattern: "加微信\\s?\\w+", category: "ad" },
      { pattern: "加微信\\s?\\w+", category: "ad" },
    ],
    [
      "pii 保留 category",
      "pii",
      { piiType: "phone", category: "politics" },
      { piiType: "phone", category: "politics" },
    ],
    [
      "无 category 不注入空键",
      "keyword",
      { keywords: ["涉政"] },
      { keywords: ["涉政"] },
    ],
    [
      "空白 category 视为未设置",
      "keyword",
      { keywords: ["涉政"], category: "  " },
      { keywords: ["涉政"] },
    ],
  ];

  it.each(cases)("%s", (_name, kind, input, expected) => {
    expect(normalizePg(kind, input as never)).toEqual(expected);
    expect(normalizeMysql(kind, input as never)).toEqual(expected);
  });

  it("keyword 空 keywords 报错", () => {
    expect(() => normalizePg("keyword", { category: "porn" })).toThrow();
    expect(() => normalizeMysql("keyword", { category: "porn" })).toThrow();
  });
});

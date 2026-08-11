import { describe, expect, it } from "vitest";
import {
  buildFollowUpRewriteMessages,
  extractEntityFromHistory,
  hasPriorFollowUpQueryLeakage,
  isReferentialFollowUp,
  parseFollowUpQueryRewrite,
  resolveFollowUpQuery,
} from "../follow-up";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

describe("follow-up entity resolution", () => {
  it("detects referential follow-ups", () => {
    expect(isReferentialFollowUp("他为什么被封为宗主呢")).toBe(true);
    expect(isReferentialFollowUp("广州南沙天气如何")).toBe(false);
    expect(isReferentialFollowUp("《三体》讲了什么")).toBe(false);
    expect(isReferentialFollowUp("GPT-5 为什么这么强")).toBe(false);
  });

  it("extracts bold entity after stripping think blocks", () => {
    const entity = extractEntityFromHistory([
      {
        role: "assistant",
        content:
          `${THINK_OPEN}纠结…${THINK_CLOSE}被称为"宗主"的应该是指**蔡徐坤**。`,
      },
    ]);
    expect(entity).toBe("蔡徐坤");
  });

  it("prefers bold over earlier quoted topic words", () => {
    expect(
      extractEntityFromHistory([
        {
          role: "assistant",
          content: '被称为“宗主”的应该是指**蔡徐坤**。',
        },
      ]),
    ).toBe("蔡徐坤");
  });

  it("resolveFollowUpQuery returns empty entity when no assistant history", () => {
    expect(
      resolveFollowUpQuery([{ role: "user", content: "他为什么被封为宗主呢" }]),
    ).toEqual({ query: "", entity: "" });
  });

  it("resolveFollowUpQuery returns null for non-referential questions", () => {
    expect(
      resolveFollowUpQuery([{ role: "user", content: "广州南沙天气如何" }]),
    ).toBeNull();
  });

  it("resolveFollowUpQuery splices entity into search keywords", () => {
    expect(
      resolveFollowUpQuery([
        { role: "user", content: "我说的是最近比较活人的宗主" },
        {
          role: "assistant",
          content: '根据搜索结果，最近活跃的应该是指**蔡徐坤**。[8]',
        },
        { role: "user", content: "他为什么被封为宗主呢" },
      ]),
    ).toEqual({
      query: "蔡徐坤 他为什么被封为宗主呢",
      entity: "蔡徐坤",
    });
  });

  it("builds a bounded rewrite prompt that keeps the current query separate", () => {
    const messages = buildFollowUpRewriteMessages([
      { role: "user", content: "王虹是谁" },
      { role: "assistant", content: "王虹是一位研究员。" },
      { role: "user", content: "她最近怎么样" },
    ]);

    expect(messages?.[0]?.content).toContain("只改写当前追问");
    expect(messages?.[0]?.content).toContain("不能返回");
    expect(messages?.[1]?.content).toContain('"current_query":"她最近怎么样"');
    expect(messages?.[1]?.content).toContain("王虹是谁");
  });

  it("accepts a confident JSON rewrite and rejects unresolved pronouns", () => {
    expect(
      parseFollowUpQueryRewrite('{"resolved_query":"王虹 最近怎么样","confidence":0.96}'),
    ).toEqual({ query: "王虹 最近怎么样", confidence: 0.96 });
    expect(
      parseFollowUpQueryRewrite('{"resolved_query":"王虹是谁 她最近怎么样","confidence":0.96}'),
    ).toBeNull();
    expect(
      parseFollowUpQueryRewrite('```json\n{"resolved_query":"王虹 最近怎么样","confidence":0.96}\n```'),
    ).toEqual({ query: "王虹 最近怎么样", confidence: 0.96 });
    expect(
      parseFollowUpQueryRewrite('{"resolved_query":"王虹 最近怎么样","confidence":0.5}'),
    ).toBeNull();
  });

  it("rejects a rewrite that copies the complete prior question", () => {
    const messages = [
      { role: "user", content: "王虹是谁" },
      { role: "assistant", content: "王虹是一位研究员。" },
      { role: "user", content: "她最近怎么样" },
    ];
    expect(hasPriorFollowUpQueryLeakage("王虹是谁 最近怎么样", messages)).toBe(true);
    expect(hasPriorFollowUpQueryLeakage("王虹 最近怎么样", messages)).toBe(false);
  });
});

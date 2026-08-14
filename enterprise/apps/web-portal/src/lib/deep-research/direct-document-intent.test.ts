import { describe, expect, it } from "vitest";
import { resolveDirectPageReference } from "../web-search/direct-page";
import {
  isGenericDirectDocumentPrompt,
  resolveDirectDocumentResearchQuery,
} from "./direct-document-intent";

describe("direct document research intent", () => {
  it("turns a generic capability question into a paper-grounded research target", () => {
    const reference = resolveDirectPageReference([
      {
        role: "user",
        content: "https://arxiv.org/pdf/2606.19348 你能读懂这篇文章嘛？",
      },
    ]);

    expect(reference).not.toBeNull();
    expect(resolveDirectDocumentResearchQuery(reference!)).toBe(
      "解读用户指定的论文（arXiv 2606.19348）：研究问题、核心方法、关键实验结果、主要结论与局限",
    );
  });

  it("uses the same concrete target for a bare direct URL", () => {
    const reference = resolveDirectPageReference([
      { role: "user", content: "https://arxiv.org/abs/2606.19348" },
    ]);

    expect(reference).not.toBeNull();
    expect(resolveDirectDocumentResearchQuery(reference!)).toContain("arXiv 2606.19348");
  });

  it("preserves a specific question about the supplied document", () => {
    const reference = resolveDirectPageReference([
      {
        role: "user",
        content: "https://arxiv.org/pdf/2606.19348 Table 8 的通过率是多少？",
      },
    ]);

    expect(reference).not.toBeNull();
    expect(resolveDirectDocumentResearchQuery(reference!)).toBe(
      "围绕用户指定的论文（arXiv 2606.19348）回答：Table 8 的通过率是多少？",
    );
  });

  it("restores the unique document identity for a specific multi-turn follow-up", () => {
    const reference = resolveDirectPageReference([
      {
        role: "user",
        content: "https://arxiv.org/pdf/2606.19348 你能读懂这篇文章吗？",
      },
      { role: "assistant", content: "可以，我已经读完并总结了这篇论文。" },
      { role: "user", content: "那这篇文章的局限性是什么？" },
    ]);

    expect(reference).toMatchObject({
      identity: "arxiv:2606.19348",
      question: "那这篇文章的局限性是什么？",
      explicitInCurrentTurn: false,
    });
    expect(isGenericDirectDocumentPrompt(reference!.question)).toBe(false);
    expect(resolveDirectDocumentResearchQuery(reference!)).toBe(
      "围绕用户指定的论文（arXiv 2606.19348）回答：那这篇文章的局限性是什么？",
    );
  });

  it("does not classify a scoped analysis request as generic", () => {
    expect(isGenericDirectDocumentPrompt("请解读这篇论文的实验设计和消融结果")).toBe(false);
    expect(isGenericDirectDocumentPrompt("Can you understand this paper?")).toBe(true);
  });
});

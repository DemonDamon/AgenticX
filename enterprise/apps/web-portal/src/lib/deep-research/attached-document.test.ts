import { describe, expect, it } from "vitest";
import {
  resolveAttachedDocumentReference,
  resolveAttachedDocumentResearchQuery,
  selectAttachedDocumentEvidence,
} from "./attached-document";

describe("attached document research", () => {
  it("grounds a generic upload request in the parsed document title", () => {
    const reference = resolveAttachedDocumentReference([
      {
        role: "user",
        content: [
          "你能读懂这个文件吗？",
          "",
          "--- 附件: 2606.19348.pdf ---",
          "Reliable Agents Under Partial Observability",
          "Abstract",
          "This paper studies agent reliability.",
        ].join("\n"),
      },
    ]);

    expect(reference).toMatchObject({
      question: "你能读懂这个文件吗？",
      explicitInCurrentTurn: true,
      documents: [
        {
          fileName: "2606.19348.pdf",
          title: "Reliable Agents Under Partial Observability",
        },
      ],
    });
    expect(resolveAttachedDocumentResearchQuery(reference!)).toBe(
      "深度解读《Reliable Agents Under Partial Observability》：核心创新、方法论、关键实验与结论",
    );
  });

  it("keeps a specific question and never places the parsed body in the target", () => {
    const sentinel = "UNIQUE_PRIVATE_ATTACHMENT_BODY_SENTINEL";
    const reference = resolveAttachedDocumentReference([
      {
        role: "user",
        content: `这份报告的风险假设是什么？\n\n--- 附件：风控报告.pdf ---\n2026 风险评估\n${sentinel}`,
      },
    ]);

    const target = resolveAttachedDocumentResearchQuery(reference!);
    expect(target).toBe("围绕《2026 风险评估》研究：这份报告的风险假设是什么？");
    expect(target).not.toContain(sentinel);
    expect(target).not.toContain("附件：");
  });

  it("restores one historical upload for a follow-up question", () => {
    const reference = resolveAttachedDocumentReference([
      {
        role: "user",
        content: "请分析\n\n--- 附件: paper.pdf ---\nPaper title\nEvidence body",
      },
      { role: "assistant", content: "已经完成初步分析。" },
      { role: "user", content: "那它的局限性是什么？" },
    ]);

    expect(reference).toMatchObject({
      question: "那它的局限性是什么？",
      explicitInCurrentTurn: false,
      documents: [{ fileName: "paper.pdf", title: "Paper title" }],
    });
    expect(resolveAttachedDocumentResearchQuery(reference!)).toBe(
      "围绕《Paper title》研究：那它的局限性是什么？",
    );
  });

  it("does not guess which historical upload a follow-up refers to", () => {
    const reference = resolveAttachedDocumentReference([
      { role: "user", content: "--- 附件: a.pdf ---\nDocument A\nbody" },
      { role: "assistant", content: "A" },
      { role: "user", content: "--- 附件: b.pdf ---\nDocument B\nbody" },
      { role: "assistant", content: "B" },
      { role: "user", content: "继续深度研究它" },
    ]);

    expect(reference).toBeNull();
  });

  it("sanitizes path-like filenames and supports several current uploads", () => {
    const reference = resolveAttachedDocumentReference([
      {
        role: "user",
        content: [
          "对比这两个文件",
          "--- 附件: C:\\secret\\a.pdf ---",
          "Document A",
          "body A",
          "--- attachment: /tmp/b.pdf ---",
          "Document B",
          "body B",
        ].join("\n"),
      },
    ]);

    expect(reference?.documents.map((document) => document.fileName)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
    const target = resolveAttachedDocumentResearchQuery(reference!);
    expect(target).toContain("上传的 2 个文件（Document A、Document B）");
    expect(target).not.toContain("secret");
    expect(target).not.toContain("/tmp");
  });

  it("reuses the public-page passage ranker for uploaded document evidence", () => {
    const reference = resolveAttachedDocumentReference([
      {
        role: "user",
        content: [
          "分析消融实验",
          "--- 附件: paper.pdf ---",
          "Paper title",
          "Introduction and unrelated background.",
          "Ablation Table 8 reports UNIQUE_PASS_RATE_SENTINEL at 81 percent.",
        ].join("\n\n"),
      },
    ]);
    const evidence = selectAttachedDocumentEvidence(
      reference!.documents[0]!,
      ["Ablation Table 8 pass rate"],
      2_000,
    );

    expect(evidence.text).toContain("UNIQUE_PASS_RATE_SENTINEL");
    expect(evidence.url).toMatch(/^attachment:/u);
  });
});

import { describe, expect, it } from "vitest";
import {
  chunkDirectPageText,
  matchesDirectPage,
  resolveDirectPageReference,
  selectDirectPageEvidence,
  type DirectPageView,
} from "../direct-page";

describe("direct public page", () => {
  it("separates prose glued to a modern arXiv URL through the arXiv adapter", () => {
    const reference = resolveDirectPageReference([
      {
        role: "user",
        content: "https://arxiv.org/pdf/2606.19348你能读懂这篇文章嘛?",
      },
    ]);
    expect(reference).toMatchObject({
      adapterId: "arxiv",
      identity: "arxiv:2606.19348",
      readUrl: "https://arxiv.org/html/2606.19348",
      question: "你能读懂这篇文章嘛?",
      explicitInCurrentTurn: true,
    });
  });

  it("parses the duplicated malformed Markdown link without leaking its syntax", () => {
    const reference = resolveDirectPageReference([
      {
        role: "user",
        content:
          "[https://arxiv.org/pdf/2606.19348你能读懂这篇文章嘛?](https://arxiv.org/pdf/2606.19348你能读懂这篇文章嘛?)",
      },
    ]);
    expect(reference).toMatchObject({
      readUrl: "https://arxiv.org/html/2606.19348",
      question: "你能读懂这篇文章嘛?",
    });
  });

  it("normalizes abs/html/pdf variants without maintaining phrase rules", () => {
    for (const url of [
      "https://arxiv.org/abs/2606.19348v1",
      "https://arxiv.org/html/2606.19348v1",
      "https://arxiv.org/pdf/2606.19348v1.pdf",
    ]) {
      expect(resolveDirectPageReference([{ role: "user", content: url }])).toMatchObject({
        identity: "arxiv:2606.19348",
        readUrl: "https://arxiv.org/html/2606.19348v1",
      });
    }
  });

  it("keeps a valid generic CJK URL intact", () => {
    const reference = resolveDirectPageReference([
      { role: "user", content: "https://example.com/论文解读" },
    ]);
    expect(reference).toMatchObject({
      adapterId: "public-web",
      question: "",
    });
    expect(reference?.readUrl).toContain("%E8%AE%BA%E6%96%87%E8%A7%A3%E8%AF%BB");
  });

  it("reuses one historical document but refuses ambiguous multi-document history", () => {
    const followUp = resolveDirectPageReference([
      { role: "user", content: "https://arxiv.org/pdf/2606.19348 读一下" },
      { role: "assistant", content: "好的" },
      { role: "user", content: "Table 8 的通过率是什么？" },
    ]);
    expect(followUp).toMatchObject({
      identity: "arxiv:2606.19348",
      question: "Table 8 的通过率是什么？",
      explicitInCurrentTurn: false,
    });

    expect(
      resolveDirectPageReference([
        { role: "user", content: "https://arxiv.org/pdf/2606.19348" },
        { role: "user", content: "https://example.com/another" },
        { role: "user", content: "继续" },
      ]),
    ).toBeNull();
  });

  it("uses the shared BM25 ranker to find a late exact element", () => {
    const text = [
      "Paper title and abstract about coding agents.",
      "Introduction with general motivation and background.",
      "Method section describing the benchmark protocol.",
      "Table 8 Pass Rate Internal Engineers 80 percent.",
      "Conclusion and future work.",
    ].join("\n\n");
    const reference = resolveDirectPageReference([
      { role: "user", content: "https://arxiv.org/pdf/2606.19348" },
    ])!;
    const view: DirectPageView = {
      reference,
      title: "Paper",
      text,
      rawChars: text.length,
      coverage: "full_html",
      backend: "native",
    };
    const evidence = selectDirectPageEvidence(view, ["Table 8 Pass Rate"], 4_000);
    expect(evidence.matched).toBe(true);
    expect(evidence.text).toContain("Table 8 Pass Rate Internal Engineers 80 percent");
    expect(matchesDirectPage(reference, "https://arxiv.org/abs/2606.19348v1")).toBe(true);
    expect(matchesDirectPage(reference, "https://arxiv.org/html/2606.19348")).toBe(true);
  });

  it("retrieves a spaced figure caption from a compact follow-up identifier", () => {
    const text = [
      "Paper title and abstract about coding agents.",
      "11 11 11 unrelated numeric benchmark cells.",
      "Figure 11: Win-rate comparison across analysis, generation, editing tasks, and overall performance.",
      "Conclusion and future work.",
    ].join("\n\n");
    const reference = resolveDirectPageReference([
      { role: "user", content: "https://arxiv.org/pdf/2606.19348" },
    ])!;
    const view: DirectPageView = {
      reference,
      title: "Paper",
      text,
      rawChars: text.length,
      coverage: "full_html",
      backend: "native",
    };

    const evidence = selectDirectPageEvidence(view, ["figure11 讲了啥"], 4_000);

    expect(evidence.matched).toBe(true);
    expect(evidence.text).toContain("Figure 11: Win-rate comparison");
  });

  it("keeps distinct compact identifiers covered in one bounded response", () => {
    const text = [
      "Paper title and abstract.",
      "Table 1: Comparison of three base models under the same evaluation setting.",
      "Unrelated middle section with many results.",
      "Table 2: Comparison of three reasoning modes.",
    ].join("\n\n");
    const reference = resolveDirectPageReference([
      { role: "user", content: "https://arxiv.org/pdf/2606.19348" },
    ])!;
    const view: DirectPageView = {
      reference,
      title: "Paper",
      text,
      rawChars: text.length,
      coverage: "full_html",
      backend: "native",
    };

    const evidence = selectDirectPageEvidence(view, ["描述一下 table1 和 table2"], 4_000);

    expect(evidence.text).toContain("Table 1: Comparison of three base models");
    expect(evidence.text).toContain("Table 2: Comparison of three reasoning modes");
  });

  it("falls back to leading passages when lexical retrieval has no match", () => {
    const passages = chunkDirectPageText(
      "Title\n\nAbstract text\n\nIntroduction text\n\nLate appendix sentinel",
      40,
    );
    expect(passages[0]).toContain("Title");
    expect(passages.at(-1)).toContain("Late appendix sentinel");
  });
});

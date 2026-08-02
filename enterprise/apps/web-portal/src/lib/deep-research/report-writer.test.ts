import { describe, expect, it } from "vitest";
import {
  MAX_SECTIONS,
  SECTION_TARGET_CHARS,
  buildSectionMessages,
  linkifyCitations,
  parseOutlineJson,
  renderTableOfContents,
} from "./report-writer";

describe("parseOutlineJson", () => {
  it("parses fenced json", () => {
    const raw = "```json\n{\"title\":\"T\",\"sections\":[{\"id\":\"s1\",\"title\":\"核心结论\",\"brief\":\"b\",\"citation_indexes\":[1]}]}\n```";
    const outline = parseOutlineJson(raw, "fallback");
    expect(outline.title).toBe("T");
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0]?.title).toBe("核心结论");
    expect(outline.sections[0]?.citationIndexes).toEqual([1]);
  });

  it("keeps a full outline when the model prefixes a think block", () => {
    const sections = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i + 1}`,
      title: `章节${i + 1}`,
      brief: "b",
      citation_indexes: [i + 1],
    }));
    const raw = `<think>先想大纲，可能要 {5} 节</think>${JSON.stringify({ title: "T", sections })}`;
    const outline = parseOutlineJson(raw, "fallback");
    expect(outline.title).toBe("T");
    expect(outline.sections).toHaveLength(6);
    expect(outline.sections[5]?.title).toBe("章节6");
  });

  it("falls back to default three sections when sections empty", () => {
    const outline = parseOutlineJson('{"title":"X","sections":[]}', "主题");
    expect(outline.title).toBe("X");
    expect(outline.sections).toHaveLength(3);
    expect(outline.sections[0]?.title).toBe("核心结论");
    expect(outline.sections[2]?.title).toBe("不确定性与信息缺口");
  });

  it("falls back on non-json without throwing", () => {
    const outline = parseOutlineJson("memo", "主题");
    expect(outline.sections).toHaveLength(3);
    expect(outline.title).toBe("主题");
  });

  it("truncates sections beyond MAX_SECTIONS", () => {
    const sections = Array.from({ length: MAX_SECTIONS + 3 }, (_, i) => ({
      id: `s${i + 1}`,
      title: `节${i + 1}`,
      brief: "b",
      citation_indexes: [],
    }));
    const outline = parseOutlineJson(JSON.stringify({ title: "T", sections }), "T");
    expect(outline.sections).toHaveLength(MAX_SECTIONS);
  });
});

describe("renderTableOfContents / buildSectionMessages", () => {
  it("renders toc entries matching section count", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "A", brief: "a" },
          { id: "s2", title: "B", brief: "b" },
        ],
      }),
      "T",
    );
    const toc = renderTableOfContents(outline);
    expect(toc).toContain("## 目录");
    expect(toc).toContain("1. A");
    expect(toc).toContain("2. B");
  });

  it("includes evidence and previous summaries in section messages", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [{ id: "s1", title: "核心结论", brief: "总结", citation_indexes: [2] }],
      }),
      "T",
    );
    const messages = buildSectionMessages({
      outline,
      section: outline.sections[0]!,
      sectionIndex: 0,
      evidence: "证据包正文",
      previousSummaries: ["前文摘要一段"],
    });
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("证据包正文");
    expect(user).toContain("前文摘要一段");
    expect(user).toContain("2");
  });

  it("gives the lead section a distinct, shorter brief than later sections", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "总结" },
          { id: "s2", title: "分项分析", brief: "展开" },
        ],
      }),
      "T",
    );
    const systemAt = (sectionIndex: number) =>
      buildSectionMessages({
        outline,
        section: outline.sections[sectionIndex]!,
        sectionIndex,
        evidence: "e",
        previousSummaries: [],
      }).find((m) => m.role === "system")?.content ?? "";

    const lead = systemAt(0);
    const body = systemAt(1);
    expect(lead).toContain("400–800 字");
    expect(body).toContain(String(SECTION_TARGET_CHARS));
    expect(body).not.toContain("400–800 字");
    expect(lead).not.toBe(body);
  });
});

describe("linkifyCitations", () => {
  it("linkifies consecutive valid indexes", () => {
    expect(linkifyCitations("结论 [1][2]", new Set([1, 2]))).toBe(
      "结论 [1](#ref-1)[2](#ref-2)",
    );
  });

  it("leaves unknown indexes as plain text", () => {
    expect(linkifyCitations("见 [99]", new Set([1, 2]))).toBe("见 [99]");
  });

  it("does not re-process existing markdown links", () => {
    expect(linkifyCitations("已是 [1](#ref-1)", new Set([1]))).toBe(
      "已是 [1](#ref-1)",
    );
  });

  it("skips fenced code blocks", () => {
    const md = "正文 [1]\n\n```\ncode [1]\n```\n\n后 [2]";
    expect(linkifyCitations(md, new Set([1, 2]))).toBe(
      "正文 [1](#ref-1)\n\n```\ncode [1]\n```\n\n后 [2](#ref-2)",
    );
  });
});

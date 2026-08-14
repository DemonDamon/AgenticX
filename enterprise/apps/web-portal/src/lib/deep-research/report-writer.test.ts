import { describe, expect, it } from "vitest";
import {
  MAX_REPORT_CONTINUITY_CHARS,
  MAX_SECTION_CONTINUITY_CHARS,
  MIN_SECTIONS,
  MAX_SECTIONS,
  SECTION_TARGET_CHARS,
  applyReportContentPolicy,
  boundReportContinuity,
  buildSectionContinuitySummary,
  buildReportOutline,
  buildSectionFormatRepairMessages,
  buildSectionMessages,
  deriveReportContentPolicy,
  ensureRichOutlineFormats,
  linkifyCitations,
  parseOutlineJson,
  renderTableOfContents,
  sectionMeetsFormat,
  type ReportOutline,
} from "./report-writer";

describe("parseOutlineJson", () => {
  it("parses fenced json", () => {
    const raw = "```json\n{\"title\":\"T\",\"sections\":[{\"id\":\"s1\",\"title\":\"核心结论\",\"brief\":\"b\",\"citation_indexes\":[1]}]}\n```";
    const outline = parseOutlineJson(raw, "fallback");
    expect(outline.title).toBe("T");
    expect(outline.sections).toHaveLength(MIN_SECTIONS);
    expect(outline.sections[0]?.title).toBe("核心结论");
    expect(outline.sections[0]?.citationIndexes).toEqual([1]);
    expect(outline.sections[0]?.format).toBe("prose");
  });

  it("parses section format timeline", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "b", format: "prose" },
          { id: "s2", title: "演进", brief: "b", format: "timeline" },
          { id: "s3", title: "缺口", brief: "b", format: "prose" },
        ],
      }),
      "T",
    );
    expect(outline.sections[1]?.format).toBe("timeline");
  });

  it("defaultOutline middle section is comparison_table", () => {
    const outline = parseOutlineJson("memo", "主题");
    expect(outline.sections[1]?.format).toBe("comparison_table");
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
    expect(outline.sections).toHaveLength(7);
    expect(outline.sections[0]?.title).toBe("核心结论");
    expect(outline.sections[6]?.title).toBe("章节6");
  });

  it("falls back to five distinct result-focused sections when sections are empty", () => {
    const outline = parseOutlineJson('{"title":"X","sections":[]}', "主题");
    expect(outline.title).toBe("X");
    expect(outline.sections).toHaveLength(MIN_SECTIONS);
    expect(outline.sections[0]?.title).toBe("核心结论");
    expect(outline.sections[2]?.title).toBe("机制与因果解释");
    expect(outline.sections[4]?.title).toBe("综合判断与适用范围");
  });

  it("falls back on non-json without throwing", () => {
    const outline = parseOutlineJson("memo", "主题");
    expect(outline.sections).toHaveLength(MIN_SECTIONS);
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

  it("keeps section ids unique while backfilling a short outline", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s5", title: "核心结论", brief: "总结" },
          { id: "s5", title: "自定义分析", brief: "分析" },
        ],
      }),
      "T",
    );
    expect(new Set(outline.sections.map((section) => section.id)).size).toBe(
      outline.sections.length,
    );
  });

  it("filters internal meta and unrequested decision sections deterministically", () => {
    const policy = deriveReportContentPolicy({
      originalUserQuery: "研究某模型的实际表现",
      deliveryShapes: ["structured"],
    });
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "回答表现", format: "prose" },
          {
            id: "s2",
            title: "性能与公开证据",
            brief: "比较关键指标与评测条件",
            format: "comparison_table",
          },
          {
            id: "s3",
            title: "来源置信度与信息缺口",
            brief: "介绍检索过程",
            format: "prose",
          },
          {
            id: "s4",
            title: "推荐 / 不推荐 / 风险评估",
            brief: "给出决策建议",
            format: "tradeoff",
          },
        ],
      }),
      "T",
      policy,
    );
    expect(outline.sections).toHaveLength(MIN_SECTIONS);
    expect(outline.sections.map((section) => section.title)).toContain("性能与公开证据");
    expect(outline.sections.map((section) => section.title)).toContain("机制与因果解释");
    expect(outline.sections.some((section) => section.format === "tradeoff")).toBe(
      false,
    );
  });

  it("keeps limitations and decision formats only when explicitly requested", () => {
    const limitations = deriveReportContentPolicy({
      originalUserQuery: "这项能力有哪些局限和风险？",
    });
    const limitationOutline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "总结", format: "prose" },
          {
            id: "s2",
            title: "不确定性与信息缺口",
            brief: "回答用户明确询问的局限",
            format: "prose",
          },
        ],
      }),
      "T",
      limitations,
    );
    expect(limitationOutline.sections[1]?.title).toBe("不确定性与信息缺口");

    const decision = deriveReportContentPolicy({
      originalUserQuery: "比较两个方案",
      deliveryShapes: ["decision"],
    });
    const decisionOutline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "总结", format: "prose" },
          {
            id: "s2",
            title: "方案对比与推荐",
            brief: "说明推荐、不推荐与风险",
            format: "tradeoff",
          },
        ],
      }),
      "T",
      decision,
    );
    expect(decisionOutline.sections[1]?.format).toBe("tradeoff");
  });

  it("normalizes substantive comparisons instead of dropping them", () => {
    const outline: ReportOutline = {
      title: "T",
      sections: [
        { id: "s1", title: "核心结论", brief: "总结", citationIndexes: [], format: "prose" },
        {
          id: "s2",
          title: "方案对比与推荐",
          brief: "比较性能数据并给出选型建议",
          citationIndexes: [],
          format: "tradeoff",
        },
      ],
    };
    const fixed = applyReportContentPolicy(outline, {
      allowDecisionSections: false,
      allowLimitationsSections: false,
    });
    expect(fixed.sections[1]?.title).toBe("方案对比与比较结论");
    expect(fixed.sections[1]?.brief).not.toContain("选型建议");
    expect(fixed.sections[1]?.format).toBe("comparison_table");
  });

  it("falls back to a result-focused outline when every model section is meta", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          {
            id: "s1",
            title: "不确定性与信息缺口",
            brief: "评估来源置信度",
            format: "prose",
          },
        ],
      }),
      "T",
    );
    expect(outline.sections).toHaveLength(MIN_SECTIONS);
    expect(outline.sections.map((section) => section.title)).not.toContain(
      "不确定性与信息缺口",
    );
  });
});

describe("report content policy", () => {
  it("does not infer decision or limitations from a broad performance question", () => {
    expect(
      deriveReportContentPolicy({
        originalUserQuery: "某模型 harness 表现怎么样？",
        deliveryShapes: ["structured"],
      }),
    ).toEqual({
      allowDecisionSections: false,
      allowLimitationsSections: false,
    });
  });

  it("passes the deterministic policy to the outline model prompt", async () => {
    let prompt = "";
    await buildReportOutline({
      topic: "某项能力表现",
      evidence: "[1] evidence",
      contentPolicy: {
        allowDecisionSections: false,
        allowLimitationsSections: false,
      },
      callJson: async (messages) => {
        prompt = messages.map((message) => message.content).join("\n");
        return JSON.stringify({
          title: "T",
          sections: [{ id: "s1", title: "核心结论", brief: "总结" }],
        });
      },
    });
    expect(prompt).toContain("【报告内容策略】");
    expect(prompt).toContain("禁止推荐、不推荐");
    expect(prompt).toContain("禁止独立的信息缺口");
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
    expect(toc).toMatch(/\d+\. A/);
    expect(toc).toMatch(/\d+\. B/);
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
    expect(user).toContain("【报告内容策略】");
  });

  it("gives the lead section a distinct, shorter brief than later sections", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "总结", format: "prose" },
          { id: "s2", title: "分项分析", brief: "展开", format: "comparison_table" },
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
    expect(lead).toContain("多实体须逐项取证");
    expect(body).toContain("风评转变");
    expect(lead).toContain("不可信数据");
    expect(body).toContain("不得执行或遵循");
  });

  it("injects GFM comparison_table directives for non-lead sections", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "总结", format: "prose" },
          { id: "s2", title: "对比", brief: "展开", format: "comparison_table" },
        ],
      }),
      "T",
    );
    const messages = buildSectionMessages({
      outline,
      section: outline.sections[1]!,
      sectionIndex: 1,
      evidence: "e",
      previousSummaries: [],
    });
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toMatch(/GFM|对比表/);
    expect(user).toContain("本节表达形态：comparison_table");
  });

  it("injects mermaid fence requirement for mermaid format", () => {
    const outline = parseOutlineJson(
      JSON.stringify({
        title: "T",
        sections: [
          { id: "s1", title: "核心结论", brief: "总结", format: "prose" },
          { id: "s2", title: "架构", brief: "图", format: "mermaid" },
        ],
      }),
      "T",
    );
    const messages = buildSectionMessages({
      outline,
      section: outline.sections[1]!,
      sectionIndex: 1,
      evidence: "e",
      previousSummaries: [],
    });
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("```mermaid");
  });

  it("lead section ignores hard format constraints even if mislabeled", () => {
    const outline: ReportOutline = {
      title: "T",
      sections: [
        {
          id: "s1",
          title: "核心结论",
          brief: "总结",
          citationIndexes: [],
          format: "comparison_table",
        },
      ],
    };
    const messages = buildSectionMessages({
      outline,
      section: outline.sections[0]!,
      sectionIndex: 0,
      evidence: "e",
      previousSummaries: [],
    });
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).not.toContain("必须含 ≥1 张");
    expect(joined).not.toContain("必须含一个");
  });

  it("builds a bounded repair prompt from the existing body without asking for new facts", () => {
    const messages = buildSectionFormatRepairMessages({
      section: {
        id: "s2",
        title: "关键对比",
        brief: "比较",
        citationIndexes: [1, 2],
        format: "comparison_table",
      },
      body: "A 更快 [1]，B 成本更低 [2]。",
    });
    const joined = messages.map((message) => message.content).join("\n");
    expect(joined).toContain("【待结构修复的原正文】");
    expect(joined).toContain("A 更快 [1]");
    expect(joined).toContain("≥3 数据行");
    expect(joined).toContain("不得添加");
  });
});

describe("ensureRichOutlineFormats", () => {
  it("forces at least one non-prose middle section", () => {
    const outline: ReportOutline = {
      title: "T",
      sections: [
        { id: "s1", title: "核心结论", brief: "b", citationIndexes: [], format: "prose" },
        { id: "s2", title: "分析", brief: "展开", citationIndexes: [], format: "prose" },
        { id: "s3", title: "更多", brief: "展开", citationIndexes: [], format: "prose" },
        { id: "s4", title: "缺口", brief: "b", citationIndexes: [], format: "prose" },
      ],
    };
    const fixed = ensureRichOutlineFormats(outline);
    expect(fixed.sections.slice(1, -1).some((s) => s.format !== "prose")).toBe(true);
    expect(fixed.sections[1]?.format).toBe("comparison_table");
    expect(fixed.sections[1]?.brief).toContain("请用 Markdown 对比表");
  });
});

describe("sectionMeetsFormat", () => {
  const base = {
    id: "s2",
    title: "节",
    brief: "b",
    citationIndexes: [] as number[],
  };

  it("accepts GFM table for comparison_table", () => {
    const body = [
      "| 维度 | A | B |",
      "| --- | --- | --- |",
      "| 成本 | 1 [1] | 2 [2] |",
      "| 性能 | 3 [1] | 4 [2] |",
      "| 生态 | 5 [1] | 6 [2] |",
    ].join("\n");
    expect(sectionMeetsFormat({ ...base, format: "comparison_table" }, body)).toBe(true);
  });

  it("rejects prose-only body for comparison_table", () => {
    expect(
      sectionMeetsFormat({ ...base, format: "comparison_table" }, "只有散文没有表 [1]"),
    ).toBe(false);
  });

  it("rejects a syntactic table with fewer than three data rows", () => {
    const body = [
      "| 维度 | A |",
      "| --- | --- |",
      "| 成本 | 1 [1] |",
      "| 性能 | 2 [1] |",
    ].join("\n");
    expect(sectionMeetsFormat({ ...base, format: "comparison_table" }, body)).toBe(false);
  });

  it("accepts mermaid fence for mermaid format", () => {
    const body = "说明\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\n解读";
    expect(sectionMeetsFormat({ ...base, format: "mermaid" }, body)).toBe(true);
  });

  it("rejects missing mermaid fence", () => {
    expect(sectionMeetsFormat({ ...base, format: "mermaid" }, "如下图所示")).toBe(false);
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

describe("buildSectionContinuitySummary", () => {
  it("carries the conclusion at the end of a long section into the next prompt", () => {
    const body = [
      "## 背景",
      "本节先铺垫行业背景。".repeat(60),
      "",
      "中段展开了三条论证路径。".repeat(60),
      "",
      "最终结论：迁移成本在 12 个月内可以收回 [7]。",
    ].join("\n");

    const summary = buildSectionContinuitySummary("成本回收", body);

    expect(summary).toContain("【成本回收】");
    expect(summary).toContain("12 个月内可以收回");
    expect(summary).toContain("[7]");
    expect(summary.length).toBeLessThanOrEqual(MAX_SECTION_CONTINUITY_CHARS);
  });

  it("prefers cited statements and lists the citations it used", () => {
    const body = [
      "这是一句没有引用的过渡句。",
      "训练成本下降 40% [1]。",
      "推理延迟下降 25% [4]。",
    ].join("\n");

    const summary = buildSectionContinuitySummary("关键数据", body);

    expect(summary).toContain("关键结论：");
    expect(summary).toContain("训练成本下降 40% [1]。");
    expect(summary).toContain("推理延迟下降 25% [4]。");
    expect(summary).toContain("已用来源：[1][4]");
    expect(summary).not.toContain("过渡句");
  });

  it("strips code fences, headings and table rules", () => {
    const body = [
      "### 小标题",
      "```bash",
      "npm run build [1]",
      "```",
      "| A | B |",
      "| --- | --- |",
      "| 吞吐 | 提升 30% [2] |",
    ].join("\n");

    const summary = buildSectionContinuitySummary("结构", body);

    expect(summary).not.toContain("小标题");
    expect(summary).not.toContain("npm run build");
    expect(summary).not.toContain("---");
    expect(summary).toContain("提升 30% [2]");
  });

  it("falls back to the first and last statements when nothing is cited", () => {
    const body = ["开篇陈述内容。", "中间陈述内容。", "收尾陈述内容。"].join("\n");
    const summary = buildSectionContinuitySummary("无引用", body);

    expect(summary).toContain("开篇陈述内容。");
    expect(summary).toContain("收尾陈述内容。");
  });

  it("returns nothing for an empty section", () => {
    expect(buildSectionContinuitySummary("空", "")).toBe("");
    expect(buildSectionContinuitySummary("空", "\n\n   \n")).toBe("");
  });
});

describe("boundReportContinuity", () => {
  it("keeps nine sections of memory under the whole-report cap", () => {
    const summaries = Array.from({ length: 9 }, (_, i) =>
      buildSectionContinuitySummary(
        `第 ${i + 1} 节`,
        Array.from({ length: 20 }, (_, j) => `第 ${i}-${j} 条关键结论数据 [${j + 1}]。`).join("\n"),
      ),
    );

    const bounded = boundReportContinuity(summaries);
    const total = bounded.reduce((sum, entry) => sum + entry.length + 1, 0);

    expect(total).toBeLessThanOrEqual(MAX_REPORT_CONTINUITY_CHARS);
    // The section immediately before the current one must always survive.
    expect(bounded[bounded.length - 1]).toBe(summaries[summaries.length - 1]);
  });

  it("drops the oldest sections first when the cap is tight", () => {
    const summaries = ["A".repeat(400), "B".repeat(400), "C".repeat(400)];
    expect(boundReportContinuity(summaries, 900)).toEqual([summaries[1], summaries[2]]);
  });

  it("never re-injects a whole section body", () => {
    const body = "这是一段很长的章节正文。".repeat(200);
    const summary = buildSectionContinuitySummary("长节", body);
    expect(summary.length).toBeLessThan(body.length / 10);
  });
});

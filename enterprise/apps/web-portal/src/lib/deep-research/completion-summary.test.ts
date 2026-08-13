import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_HREF_PREFIX,
  artifactLinkLabel,
  buildCompletionSummary,
  COMPLETION_SUMMARY_MAX_CHARS,
  fallbackSummary,
  linkifyArtifactMentions,
  normalizeBareArtifactRefs,
  selectSummaryArtifacts,
  stripSummaryMetaBlocks,
  type CompletionSummaryInput,
} from "./completion-summary";

const baseInput: CompletionSummaryInput = {
  topic: "DeepSeek V4 核心技术点",
  outline: {
    title: "DeepSeek V4 核心技术点",
    sections: [
      { id: "s1", title: "核心结论", brief: "概括架构与训练创新", citationIndexes: [], format: "prose" },
      { id: "s2", title: "分项分析", brief: "MoE / MLA / Dual-Chain", citationIndexes: [], format: "prose" },
      { id: "s3", title: "不确定性", brief: "信息缺口", citationIndexes: [], format: "prose" },
    ],
  },
  stats: {
    queriesPlanned: 12,
    urlsDiscovered: 80,
    sourcesSelected: 10,
    pagesFetched: 7,
    citationCount: 26,
  },
  artifacts: [
    {
      id: "art-final",
      path: "research/r1/final-report.md",
      title: "DeepSeek V4 核心技术点.md",
      kind: "report",
    },
    {
      id: "art-html",
      path: "research/r1/report.html",
      title: "DeepSeek V4 核心技术点.html",
      kind: "report",
    },
    {
      id: "art-md-dup",
      path: "research/r1/report.md",
      title: "Markdown",
      kind: "report",
    },
  ],
  runId: "r1",
  deliveryPrefs: { shapes: ["structured"], format: "md" },
};

describe("artifactLinkLabel", () => {
  it("strips extensions and meta blocks for a single-line label", () => {
    expect(artifactLinkLabel(baseInput.artifacts[0]!)).toBe("DeepSeek V4 核心技术点");
    expect(
      artifactLinkLabel({
        id: "x",
        path: "research/r1/report.html",
        title: "minimax H3\n\n【用户澄清】\n- a\n.html",
        kind: "report",
      }),
    ).toBe("minimax H3");
  });
});

describe("stripSummaryMetaBlocks / normalizeBareArtifactRefs", () => {
  it("removes clarify and delivery preference dumps", () => {
    const raw = [
      "🎉完成",
      "",
      "【用户澄清】",
      "- 方向：全选",
      "",
      "【交付偏好】",
      "- 主格式：html",
      "",
      "产物：",
      "- ok",
    ].join("\n");
    const out = stripSummaryMetaBlocks(raw);
    expect(out).not.toContain("【用户澄清】");
    expect(out).not.toContain("【交付偏好】");
    expect(out).toContain("产物：");
  });

  it("rewrites bare (artifact:id) into markdown links", () => {
    const out = normalizeBareArtifactRefs(
      `见 (artifact:art-final) 与 artifact:art-html`,
      baseInput.artifacts,
    );
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-html)`);
    // Bare paren form must be gone; Markdown `[label](artifact:id)` still contains `(artifact:…)`.
    expect(out).not.toMatch(/(?<!\])\(artifact:art-final\)/);
    expect(out).not.toMatch(/(?<![\w/:])artifact:art-html(?!\))/);
  });

  it("does not rewrite already-linked artifact hrefs", () => {
    const linked = `[报告](${ARTIFACT_HREF_PREFIX}art-final)`;
    expect(normalizeBareArtifactRefs(linked, baseInput.artifacts)).toBe(linked);
  });
});

describe("selectSummaryArtifacts", () => {
  it("keeps only the primary report for md prefs", () => {
    const out = selectSummaryArtifacts(baseInput.artifacts, {
      shapes: ["structured"],
      format: "md",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("art-final");
  });

  it("keeps html primary for html prefs", () => {
    const out = selectSummaryArtifacts(baseInput.artifacts, {
      shapes: ["structured"],
      format: "html",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("art-html");
  });

  it("keeps report.doc primary for docx prefs", () => {
    const artifacts = [
      ...baseInput.artifacts,
      {
        id: "art-doc",
        path: "research/r1/report.doc",
        title: "DeepSeek V4 核心技术点.doc",
        kind: "report",
      },
    ];
    const out = selectSummaryArtifacts(artifacts, {
      shapes: ["structured"],
      format: "docx",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("art-doc");
  });
});

describe("linkifyArtifactMentions", () => {
  it("turns backtick paths into artifact: links", () => {
    const out = linkifyArtifactMentions(
      "见 `research/r1/final-report.md`",
      baseInput.artifacts,
    );
    expect(out).toBe(`见 [DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
  });

  it("turns bare paths into artifact: links", () => {
    const out = linkifyArtifactMentions(
      "路径 research/r1/report.html 可打开",
      baseInput.artifacts,
    );
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-html)`);
    expect(out).not.toContain("research/r1/report.html");
  });
});

describe("buildCompletionSummary", () => {
  it("returns LLM text when callJson succeeds", async () => {
    const callJson = vi.fn(async () => "本次调研覆盖 V4 架构与训练创新，关键结论是 MoE + MLA。");
    const out = await buildCompletionSummary(baseInput, { callJson });
    expect(out).toContain("MoE + MLA");
    // Model omitted the required primary link — polish appends it.
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
    expect(callJson).toHaveBeenCalledOnce();
  });

  it("does not prompt the summary model with a zero full-text metric", async () => {
    const callJson = vi.fn(async () => "调研完成。");
    await buildCompletionSummary(
      {
        ...baseInput,
        stats: { ...baseInput.stats, pagesFetched: 0 },
      },
      { callJson },
    );

    const messages = callJson.mock.calls[0]?.[0] ?? [];
    expect(messages[1]?.content).toContain("选用来源 10 个");
    expect(messages[1]?.content).not.toContain("抓取正文");
  });

  it("appends html primary link when format is html and model omits it", async () => {
    const out = await buildCompletionSummary(
      {
        ...baseInput,
        deliveryPrefs: { shapes: ["structured"], format: "html" },
      },
      { callJson: async () => "调研完成，结论见产物。" },
    );
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-html)`);
    expect(out).not.toContain(ARTIFACT_HREF_PREFIX + "art-final");
  });

  it("rewrites bare paths from the model into clickable artifact links", async () => {
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () => "产物在：\n- `research/r1/final-report.md`",
    });
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
    expect(out).not.toContain("`research/r1/final-report.md`");
    expect(out).not.toContain(ARTIFACT_HREF_PREFIX + "art-html");
  });

  it("strips clarify meta and rewrites bare artifact refs from the model", async () => {
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () =>
        ["结论若干。", "", "【用户澄清】", "- 全选", "", `(artifact:art-final)`].join(
          "\n",
        ),
    });
    expect(out).not.toContain("【用户澄清】");
    expect(out).not.toMatch(/(?<!\])\(artifact:art-final\)/);
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
    // Clarify dump stripped; bare ref rewritten — keep the model body (not full fallback).
    expect(out).toContain("结论若干");
  });

  it("falls back when callJson returns empty", async () => {
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () => "",
    });
    expect(out).toContain("DeepSeek V4 核心技术点");
    expect(out).toContain(`${ARTIFACT_HREF_PREFIX}art-final`);
  });

  it("falls back when callJson throws", async () => {
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toContain("DeepSeek V4 核心技术点");
    expect(out).toContain("12");
  });

  it("drops a long think block instead of letting it eat the truncate window", async () => {
    const think = `<think>${"我先想想这次要怎么写摘要".repeat(200)}</think>`;
    const body = "本次调研覆盖 V4 架构与训练创新。";
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () => `${think}\n\n${body}`,
    });
    expect(out).toContain(body);
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
    expect(out).not.toContain("我先想想");
  });

  it("falls back when the model emits reasoning only", async () => {
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () => "<think>只有思考没有正文</think>",
    });
    expect(out).not.toContain("只有思考");
    expect(out).toBe(fallbackSummary(baseInput));
  });

  it("truncates long LLM output to max chars", async () => {
    const long = "字".repeat(COMPLETION_SUMMARY_MAX_CHARS + 500);
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () => long,
    });
    expect(out.length).toBeLessThanOrEqual(COMPLETION_SUMMARY_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("fallbackSummary", () => {
  it("includes topic, stats, and a single primary report link", () => {
    const out = fallbackSummary(baseInput);
    expect(out).toContain("DeepSeek V4 核心技术点");
    expect(out).toContain("12");
    expect(out).toContain(`[DeepSeek V4 核心技术点](${ARTIFACT_HREF_PREFIX}art-final)`);
    expect(out).not.toContain(ARTIFACT_HREF_PREFIX + "art-html");
    expect(out).not.toContain(ARTIFACT_HREF_PREFIX + "art-md-dup");
  });

  it("hides a zero full-text metric while retaining the other stats", () => {
    const out = fallbackSummary({
      ...baseInput,
      stats: { ...baseInput.stats, pagesFetched: 0 },
    });

    expect(out).toContain("规划检索 12 次");
    expect(out).toContain("选用来源 10 个");
    expect(out).toContain("引用源 26 个");
    expect(out).not.toContain("抓取正文");
  });

  it("sanitizes polluted topic and does not emit multi-line link labels", () => {
    const out = fallbackSummary({
      ...baseInput,
      topic: "minimax H3 核心技术点\n\n【用户澄清】\n- 全选\n\n【交付偏好】\n- html",
      artifacts: [
        {
          id: "art-html",
          path: "research/r1/report.html",
          title: "minimax H3 核心技术点\n\n【用户澄清】\n- x\n.html",
          kind: "report",
        },
      ],
      deliveryPrefs: { shapes: ["structured"], format: "html" },
    });
    expect(out).toContain("🎉「minimax H3 核心技术点」深度调研完成。");
    expect(out).not.toContain("【用户澄清】");
    expect(out).not.toContain("【交付偏好】");
    expect(out).toContain(`[minimax H3 核心技术点](${ARTIFACT_HREF_PREFIX}art-html)`);
    expect(out).not.toMatch(/\[minimax H3 核心技术点\n/);
  });

  it("falls back to html when md primary is missing", () => {
    const out = fallbackSummary({
      ...baseInput,
      artifacts: [
        { id: "art-html", path: "research/r1/report.html", title: "HTML", kind: "report" },
      ],
    });
    expect(out).not.toContain("final-report");
    expect(out).toContain(`[HTML](${ARTIFACT_HREF_PREFIX}art-html)`);
  });

  it("caps section list at 8", () => {
    const sections = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i + 1}`,
      title: `章节${i + 1}`,
      brief: "b",
      citationIndexes: [] as number[],
      format: "prose" as const,
    }));
    const out = fallbackSummary({ ...baseInput, outline: { title: "t", sections } });
    expect(out).not.toContain("章节12");
    expect(out).toContain("章节8");
  });
});

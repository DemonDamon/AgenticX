import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_HREF_PREFIX,
  buildCompletionSummary,
  COMPLETION_SUMMARY_MAX_CHARS,
  fallbackSummary,
  linkifyArtifactMentions,
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
      title: "终稿",
      kind: "report",
    },
    {
      id: "art-html",
      path: "research/r1/report.html",
      title: "HTML",
      kind: "report",
    },
  ],
  runId: "r1",
};

describe("linkifyArtifactMentions", () => {
  it("turns backtick paths into artifact: links", () => {
    const out = linkifyArtifactMentions(
      "见 `research/r1/final-report.md`",
      baseInput.artifacts,
    );
    expect(out).toBe(`见 [终稿](${ARTIFACT_HREF_PREFIX}art-final)`);
  });

  it("turns bare paths into artifact: links", () => {
    const out = linkifyArtifactMentions(
      "路径 research/r1/report.html 可打开",
      baseInput.artifacts,
    );
    expect(out).toContain(`[HTML](${ARTIFACT_HREF_PREFIX}art-html)`);
    expect(out).not.toContain("research/r1/report.html");
  });
});

describe("buildCompletionSummary", () => {
  it("returns LLM text when callJson succeeds", async () => {
    const callJson = vi.fn(async () => "本次调研覆盖 V4 架构与训练创新，关键结论是 MoE + MLA。");
    const out = await buildCompletionSummary(baseInput, { callJson });
    expect(out).toContain("MoE + MLA");
    expect(callJson).toHaveBeenCalledOnce();
  });

  it("rewrites bare paths from the model into clickable artifact links", async () => {
    const out = await buildCompletionSummary(baseInput, {
      callJson: async () =>
        "产物在：\n- `research/r1/final-report.md`\n- research/r1/report.html",
    });
    expect(out).toContain(`[终稿](${ARTIFACT_HREF_PREFIX}art-final)`);
    expect(out).toContain(`[HTML](${ARTIFACT_HREF_PREFIX}art-html)`);
    expect(out).not.toContain("`research/r1/final-report.md`");
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
    expect(out).toBe(body);
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
  it("includes topic, stats, and clickable final-report link when present", () => {
    const out = fallbackSummary(baseInput);
    expect(out).toContain("DeepSeek V4 核心技术点");
    expect(out).toContain("12");
    expect(out).toContain(`[终稿](${ARTIFACT_HREF_PREFIX}art-final)`);
  });

  it("does not mention final-report when no such artifact", () => {
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

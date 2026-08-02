/**
 * Deep-research completion summary: LLM-generated natural-language wrap-up
 * (not a fixed template). Falls back to a minimal template if the model fails.
 */

import { stripThinkBlocks } from "./content-clean";
import type { ReportOutline } from "./report-writer";

export const COMPLETION_SUMMARY_MAX_CHARS = 1_600;

export type CompletionSummaryInput = {
  topic: string;
  outline: Pick<ReportOutline, "title" | "sections">;
  stats: {
    queriesPlanned: number;
    urlsDiscovered: number;
    sourcesSelected: number;
    pagesFetched: number;
    citationCount: number;
  };
  artifacts: Array<{ path: string; title: string; kind: string }>;
  runId: string;
};

export type CompletionSummaryDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
};

const SUMMARY_SYSTEM = [
  "你是深度调研收尾摘要助手。调研已全部完成，请用自然语言写一段给用户看的完成摘要。",
  "使用与用户提问相同的语言；输出 Markdown；总长 ≤ 600 字；只输出正文，不要 ```markdown 围栏。",
  "必须包含三块信息，但措辞与详略由你据实决定，不要机械堆数字：",
  "1. 本次做了什么：基于大纲章节与统计，概括调研覆盖范围与关键发现（不要复述整篇报告正文）。",
  "2. 关键结论亮点：提炼 2–4 条最有价值的结论；若引用证据则带 [N] 编号，编号必须真实存在。",
  "3. 产物在哪：仅列出实际产生的文件路径（不要编造未出现的文件），指引用户在右侧产物或交付卡片打开。",
  "禁止复述报告全文；禁止编造文件；禁止编造引用编号。",
].join("\n");

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function sectionList(outline: CompletionSummaryInput["outline"]): string {
  const titles = outline.sections.map((s) => s.title).filter(Boolean);
  const capped = titles.slice(0, 8);
  return capped.join("、") || "（未生成章节）";
}

/** 极简兜底，不调模型。 */
export function fallbackSummary(input: CompletionSummaryInput): string {
  const lines: string[] = [];
  lines.push(`🎉「${input.topic || input.outline.title || "调研"}」深度调研完成。`);
  lines.push("");
  const s = input.stats;
  lines.push(
    `本次规划检索 ${s.queriesPlanned} 次、选用来源 ${s.sourcesSelected} 个、抓取正文 ${s.pagesFetched} 篇，共 ${s.citationCount} 个引用。`,
  );
  lines.push(`报告章节：${sectionList(input.outline)}。`);
  const paths = input.artifacts.map((a) => a.path).filter(Boolean);
  if (paths.length > 0) {
    lines.push("");
    lines.push("产物：");
    for (const p of paths) lines.push(`- \`${p}\``);
    if (paths.some((p) => p.endsWith("final-report.md"))) {
      lines.push("");
      lines.push("完整正文请打开 **final-report.md**。");
    }
  }
  return truncate(lines.join("\n"), COMPLETION_SUMMARY_MAX_CHARS);
}

/** LLM 生成；失败/空时回落到 fallbackSummary()。 */
export async function buildCompletionSummary(
  input: CompletionSummaryInput,
  deps: CompletionSummaryDeps,
): Promise<string> {
  const s = input.stats;
  const sections = input.outline.sections
    .map((sec, i) => `${i + 1}. ${sec.title}：${sec.brief}`)
    .join("\n");
  const artifacts = input.artifacts
    .map((a) => `- ${a.path}（${a.kind}）`)
    .join("\n");

  const user = [
    `主题：${input.topic || input.outline.title}`,
    `大纲章节：`,
    sections || "（无）",
    `统计：规划检索 ${s.queriesPlanned} 次，发现 ${s.urlsDiscovered} 个候选，选用 ${s.sourcesSelected} 个，抓取正文 ${s.pagesFetched} 篇，引用源 ${s.citationCount} 个。`,
    `实际产物：`,
    artifacts || "（无）",
    `runId：${input.runId}`,
  ].join("\n\n");

  try {
    const raw = await deps.callJson([
      { role: "system", content: SUMMARY_SYSTEM },
      { role: "user", content: user },
    ]);
    // Strip before truncate: a long <think> block would otherwise eat the
    // whole window and leave the chat with reasoning-only content.
    const text = stripThinkBlocks(raw ?? "").trim();
    if (!text) return fallbackSummary(input);
    return truncate(text, COMPLETION_SUMMARY_MAX_CHARS);
  } catch {
    return fallbackSummary(input);
  }
}

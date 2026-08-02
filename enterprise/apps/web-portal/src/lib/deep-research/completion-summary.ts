/**
 * Deep-research completion summary: LLM-generated natural-language wrap-up
 * (not a fixed template). Falls back to a minimal template if the model fails.
 */

import { stripThinkBlocks } from "./content-clean";
import type { ReportOutline } from "./report-writer";

export const COMPLETION_SUMMARY_MAX_CHARS = 1_600;
export const ARTIFACT_HREF_PREFIX = "artifact:";

export type CompletionSummaryArtifact = {
  id: string;
  path: string;
  title: string;
  kind: string;
};

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
  artifacts: CompletionSummaryArtifact[];
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
  "3. 产物在哪：用 Markdown 链接列出实际产物，格式必须是 [显示名](artifact:<id>)，id 只能来自下方「实际产物」列表；不要写裸路径或 `路径` 代码块。",
  "禁止复述报告全文；禁止编造文件；禁止编造引用编号；禁止编造 artifact id。",
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

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function artifactLinkLabel(artifact: CompletionSummaryArtifact): string {
  const title = artifact.title?.trim();
  if (title) return title.replace(/[\[\]]/g, "");
  return (artifact.path.split("/").pop() || artifact.path).replace(/[\[\]]/g, "");
}

function artifactMarkdownLink(artifact: CompletionSummaryArtifact): string {
  return `[${artifactLinkLabel(artifact)}](${ARTIFACT_HREF_PREFIX}${artifact.id})`;
}

/**
 * Rewrite bare / backtick artifact paths into clickable artifact: links.
 * Longest path first so nested paths are not partially replaced.
 */
export function linkifyArtifactMentions(
  text: string,
  artifacts: CompletionSummaryArtifact[],
): string {
  if (!text || artifacts.length === 0) return text;
  const sorted = [...artifacts]
    .filter((a) => a.id && a.path)
    .sort((a, b) => b.path.length - a.path.length);
  let out = text;
  for (const artifact of sorted) {
    const link = artifactMarkdownLink(artifact);
    const pathRe = escapeRegExp(artifact.path);
    out = out.replace(new RegExp(`\`${pathRe}\``, "g"), link);
    out = out.replace(new RegExp(pathRe, "g"), (match, offset: number, whole: string) => {
      // Skip if this path is already part of an artifact: href we just wrote.
      const before = whole.slice(Math.max(0, offset - ARTIFACT_HREF_PREFIX.length - 8), offset);
      if (before.includes(ARTIFACT_HREF_PREFIX)) return match;
      if (whole.slice(offset - 2, offset) === "](") return match;
      return link;
    });
  }
  return out;
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
  const withId = input.artifacts.filter((a) => a.id && a.path);
  if (withId.length > 0) {
    lines.push("");
    lines.push("产物：");
    for (const a of withId) lines.push(`- ${artifactMarkdownLink(a)}`);
    if (withId.some((a) => a.path.endsWith("final-report.md"))) {
      lines.push("");
      lines.push("完整正文请打开终稿链接，或使用下方交付卡片。");
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
    .map((a) => `- id=${a.id} path=${a.path} title=${a.title || a.path} kind=${a.kind}`)
    .join("\n");

  const user = [
    `主题：${input.topic || input.outline.title}`,
    `大纲章节：`,
    sections || "（无）",
    `统计：规划检索 ${s.queriesPlanned} 次，发现 ${s.urlsDiscovered} 个候选，选用 ${s.sourcesSelected} 个，抓取正文 ${s.pagesFetched} 篇，引用源 ${s.citationCount} 个。`,
    `实际产物（链接必须用这些 id）：`,
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
    return truncate(linkifyArtifactMentions(text, input.artifacts), COMPLETION_SUMMARY_MAX_CHARS);
  } catch {
    return fallbackSummary(input);
  }
}

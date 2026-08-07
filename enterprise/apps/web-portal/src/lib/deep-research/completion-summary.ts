/**
 * Deep-research completion summary: LLM-generated natural-language wrap-up
 * (not a fixed template). Falls back to a minimal template if the model fails.
 */

import { stripThinkBlocks } from "./content-clean";
import {
  DEFAULT_DELIVERY_PREFS,
  primaryReportPathSuffix,
  sanitizeResearchTopic,
  type DeliveryPrefs,
} from "./delivery-prefs";
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
  deliveryPrefs?: DeliveryPrefs;
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
  "3. 产物在哪：主报告链接至多 1 个，格式必须是 [显示名](artifact:<id>)，显示名用简短单行标题（不要含换行、不要含【用户澄清】或【交付偏好】），id 只能来自下方「实际产物」列表；不要罗列多份等价报告；其余引导用户使用下方交付卡片。",
  "禁止输出【用户澄清】【交付偏好】或任何澄清问卷原文；禁止复述报告全文；禁止编造文件/引用/artifact id；禁止写裸 (artifact:id) 或 artifact:id（必须用 Markdown 链接）。",
].join("\n");

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function sectionList(outline: CompletionSummaryInput["outline"]): string {
  const titles = outline.sections
    .map((s) => sanitizeResearchTopic(s.title))
    .filter((t) => t && t !== "调研报告");
  const capped = titles.slice(0, 8);
  return capped.join("、") || "（未生成章节）";
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Single-line label safe inside Markdown [label](href). */
export function artifactLinkLabel(artifact: CompletionSummaryArtifact): string {
  const fromTitle = sanitizeResearchTopic(artifact.title ?? "");
  const fromPath = (artifact.path.split("/").pop() || artifact.path).replace(
    /\.(md|html|doc)$/i,
    "",
  );
  let label = fromTitle && fromTitle !== "调研报告" ? fromTitle : fromPath;
  label = sanitizeResearchTopic(label)
    .replace(/\.(md|html|doc)$/i, "")
    .replace(/[\[\]\(\)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return label || "调研报告";
}

function artifactMarkdownLink(artifact: CompletionSummaryArtifact): string {
  return `[${artifactLinkLabel(artifact)}](${ARTIFACT_HREF_PREFIX}${artifact.id})`;
}

function isReportPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith("final-report.md") ||
    lower.endsWith("report.md") ||
    lower.endsWith("report.html") ||
    lower.endsWith("report.doc")
  );
}

/**
 * Keep at most one primary report artifact (+ any non-report attachments).
 */
export function selectSummaryArtifacts(
  artifacts: CompletionSummaryArtifact[],
  prefs: DeliveryPrefs = DEFAULT_DELIVERY_PREFS,
): CompletionSummaryArtifact[] {
  const suffix = primaryReportPathSuffix(prefs);
  const reports = artifacts.filter((a) => a.id && a.path && isReportPath(a.path));
  const others = artifacts.filter((a) => a.id && a.path && !isReportPath(a.path));

  const primary =
    reports.find((a) => a.path.toLowerCase().endsWith(suffix)) ??
    reports.find((a) => a.path.toLowerCase().endsWith("final-report.md")) ??
    reports.find((a) => a.path.toLowerCase().endsWith("report.doc")) ??
    reports.find((a) => a.path.toLowerCase().endsWith("report.html")) ??
    reports[0];

  return primary ? [primary, ...others] : others;
}

/** Drop clarify / delivery-preference blocks that models sometimes echo. */
export function stripSummaryMetaBlocks(text: string): string {
  if (!text) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^【(?:用户澄清|交付偏好)】/.test(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (
        !trimmed ||
        /^[-*•]/.test(trimmed) ||
        /^(内容形态|主格式)[:：]/.test(trimmed) ||
        /写作时优先满足/.test(trimmed)
      ) {
        continue;
      }
      skipping = false;
    }
    if (/^【(?:用户澄清|交付偏好)】/.test(trimmed)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function protectArtifactMarkdownLinks(text: string): {
  text: string;
  links: string[];
} {
  const links: string[] = [];
  const next = text.replace(/\[[^\]]*]\(artifact:[A-Za-z0-9_-]+\)/g, (match) => {
    links.push(match);
    return `\u0000ART${links.length - 1}\u0000`;
  });
  return { text: next, links };
}

function restoreProtectedLinks(text: string, links: string[]): string {
  return text.replace(/\u0000ART(\d+)\u0000/g, (_m, index: string) => {
    return links[Number(index)] ?? "";
  });
}

/**
 * Turn bare artifact:id / (artifact:id) into a Markdown link when we know the id.
 * Existing `[label](artifact:id)` links are left untouched.
 */
export function normalizeBareArtifactRefs(
  text: string,
  artifacts: CompletionSummaryArtifact[],
): string {
  if (!text || artifacts.length === 0) return text;
  const byId = new Map(artifacts.filter((a) => a.id).map((a) => [a.id, a]));
  let { text: out, links } = protectArtifactMarkdownLinks(text);

  out = out.replace(/\(artifact:([A-Za-z0-9_-]+)\)/g, (match, id: string) => {
    const art = byId.get(id);
    return art ? artifactMarkdownLink(art) : match;
  });
  // Re-protect links created from (artifact:id) before scanning bare artifact: tokens.
  ({ text: out, links } = protectArtifactMarkdownLinks(restoreProtectedLinks(out, links)));

  out = out.replace(/(?<![\w/:])artifact:([A-Za-z0-9_-]+)/g, (match, id: string) => {
    const art = byId.get(id);
    return art ? artifactMarkdownLink(art) : match;
  });
  return restoreProtectedLinks(out, links);
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

function polishSummary(
  text: string,
  artifacts: CompletionSummaryArtifact[],
): string {
  let out = stripThinkBlocks(text ?? "").trim();
  out = stripSummaryMetaBlocks(out);
  out = linkifyArtifactMentions(out, artifacts);
  out = normalizeBareArtifactRefs(out, artifacts);
  // Collapse accidental multi-line markdown link labels the model may emit.
  out = out.replace(
    /\[([^\]]{0,80})\n+([\s\S]*?)\]\((artifact:[A-Za-z0-9_-]+)\)/g,
    (_m, head: string, _tail: string, href: string) => {
      const id = href.slice(ARTIFACT_HREF_PREFIX.length);
      const art = artifacts.find((a) => a.id === id);
      if (art) return artifactMarkdownLink(art);
      const label = sanitizeResearchTopic(head).replace(/[\[\]]/g, "") || "调研报告";
      return `[${label}](${href})`;
    },
  );
  // Models often omit the required primary link — append one so users who
  // picked HTML are not left hunting final-report.md in the file list.
  const primary = artifacts[0];
  if (
    primary?.id &&
    !new RegExp(`${ARTIFACT_HREF_PREFIX}${escapeRegExp(primary.id)}`).test(out)
  ) {
    out = `${out}\n\n产物：\n- ${artifactMarkdownLink(primary)}`.trim();
  }
  return truncate(out, COMPLETION_SUMMARY_MAX_CHARS);
}

function cleanTopic(input: CompletionSummaryInput): string {
  return sanitizeResearchTopic(input.topic || input.outline.title || "调研");
}

/** 极简兜底，不调模型。 */
export function fallbackSummary(input: CompletionSummaryInput): string {
  const prefs = input.deliveryPrefs ?? DEFAULT_DELIVERY_PREFS;
  const topic = cleanTopic(input);
  const lines: string[] = [];
  lines.push(`🎉「${topic}」深度调研完成。`);
  lines.push("");
  const s = input.stats;
  lines.push(
    `本次规划检索 ${s.queriesPlanned} 次、选用来源 ${s.sourcesSelected} 个、抓取正文 ${s.pagesFetched} 篇，共 ${s.citationCount} 个引用。`,
  );
  lines.push(`报告章节：${sectionList(input.outline)}。`);
  const withId = selectSummaryArtifacts(input.artifacts, prefs);
  if (withId.length > 0) {
    lines.push("");
    lines.push("产物：");
    for (const a of withId) lines.push(`- ${artifactMarkdownLink(a)}`);
    lines.push("");
    lines.push("完整正文请打开上方链接，或使用下方交付卡片。");
  }
  return polishSummary(lines.join("\n"), withId);
}

/** LLM 生成；失败/空时回落到 fallbackSummary()。 */
export async function buildCompletionSummary(
  input: CompletionSummaryInput,
  deps: CompletionSummaryDeps,
): Promise<string> {
  const prefs = input.deliveryPrefs ?? DEFAULT_DELIVERY_PREFS;
  const summaryArtifacts = selectSummaryArtifacts(input.artifacts, prefs);
  const topic = cleanTopic(input);
  const s = input.stats;
  const sections = input.outline.sections
    .map((sec, i) => `${i + 1}. ${sanitizeResearchTopic(sec.title)}：${sec.brief}`)
    .join("\n");
  const artifacts = summaryArtifacts
    .map(
      (a) =>
        `- id=${a.id} path=${a.path} title=${artifactLinkLabel(a)} kind=${a.kind}`,
    )
    .join("\n");

  const user = [
    `主题：${topic}`,
    `大纲章节：`,
    sections || "（无）",
    `统计：规划检索 ${s.queriesPlanned} 次，发现 ${s.urlsDiscovered} 个候选，选用 ${s.sourcesSelected} 个，抓取正文 ${s.pagesFetched} 篇，引用源 ${s.citationCount} 个。`,
    `实际产物（链接必须用这些 id；主报告仅此一份；title 已是可用显示名）：`,
    artifacts || "（无）",
    `runId：${input.runId}`,
  ].join("\n\n");

  try {
    const raw = await deps.callJson([
      { role: "system", content: SUMMARY_SYSTEM },
      { role: "user", content: user },
    ]);
    const text = stripThinkBlocks(raw ?? "").trim();
    if (!text) return fallbackSummary(input);
    const polished = polishSummary(text, summaryArtifacts);
    // If the model still dumped meta / left bare (artifact:id) (not a Markdown link), fall back.
    // Note: `[label](artifact:id)` also contains `(artifact:id)` — only treat as bare when not preceded by `]`.
    if (
      /【用户澄清】|【交付偏好】/.test(polished) ||
      /(?<!\])\(artifact:[A-Za-z0-9_-]+\)/.test(polished)
    ) {
      return fallbackSummary(input);
    }
    return polished;
  } catch {
    return fallbackSummary(input);
  }
}

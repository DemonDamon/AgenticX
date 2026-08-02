/**
 * Sectioned long-form report writing for deep research.
 * outline → per-section stream → join, to bypass single-completion max_tokens.
 */

export const MIN_SECTIONS = 5;
export const MAX_SECTIONS = 9;
export const SECTION_TARGET_CHARS = 1_500;

export type ReportSection = {
  id: string;
  /** 章节标题，不含 "##" 前缀。 */
  title: string;
  /** 该节要回答什么，写给下游写作调用看。 */
  brief: string;
  /** 该节应重点引用的证据编号。 */
  citationIndexes: number[];
};

export type ReportOutline = {
  title: string;
  sections: ReportSection[];
};

export type OutlineDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  evidence: string;
};

const OUTLINE_SYSTEM = [
  "你是深度研究报告大纲助手。只输出 JSON，不要 Markdown 围栏。",
  '格式：{"title":"...","sections":[{"id":"s1","title":"...","brief":"...","citation_indexes":[1,4,7]}]}',
  `章节数 ${MIN_SECTIONS}-${MAX_SECTIONS}，按证据密度决定，宁少勿滥。`,
  "必须包含首节「核心结论」与末节「不确定性与信息缺口」，中间为分项分析。",
  "citation_indexes 只能引用证据包中真实存在的编号。",
  "使用与用户提问相同的语言。",
].join("\n");

const SECTION_SYSTEM = [
  "你是深度研究报告分节写作助手。只写当前这一节的正文，不要重复输出标题，不要写其它章节内容。",
  `目标篇幅 ≥ ${SECTION_TARGET_CHARS} 字：展开论证、给出具体数字与机制细节，禁止空话凑字。`,
  "每条事实必须以 [N] 标注，N 必须在证据包中存在，禁止编造编号。",
  "若提供了「前文已写内容摘要」，避免重复已写过的表述。",
  "只输出本节 Markdown 正文。",
].join("\n");

function defaultOutline(fallbackTitle: string): ReportOutline {
  return {
    title: fallbackTitle || "调研报告",
    sections: [
      {
        id: "s1",
        title: "核心结论",
        brief: "概括主题核心发现与判断",
        citationIndexes: [],
      },
      {
        id: "s2",
        title: "分项分析",
        brief: "按证据展开分项论证",
        citationIndexes: [],
      },
      {
        id: "s3",
        title: "不确定性与信息缺口",
        brief: "说明证据不足与待核实点",
        citationIndexes: [],
      },
    ],
  };
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function normalizeSection(
  raw: unknown,
  index: number,
): ReportSection | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null;
  const brief = typeof obj.brief === "string" ? obj.brief.trim() : title;
  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim()
      : `s${index + 1}`;
  const indexesRaw = obj.citation_indexes ?? obj.citationIndexes;
  const citationIndexes = Array.isArray(indexesRaw)
    ? indexesRaw
        .map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : NaN))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  return { id, title, brief, citationIndexes };
}

export function parseOutlineJson(raw: string, fallbackTitle: string): ReportOutline {
  const fallback = defaultOutline(fallbackTitle);
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : fallback.title;
    const sectionsRaw = Array.isArray(parsed.sections) ? parsed.sections : [];
    const sections = sectionsRaw
      .map((item, i) => normalizeSection(item, i))
      .filter((s): s is ReportSection => s != null)
      .slice(0, MAX_SECTIONS);
    if (sections.length === 0) return { ...fallback, title };
    return { title, sections };
  } catch {
    return fallback;
  }
}

export async function buildReportOutline(deps: OutlineDeps): Promise<ReportOutline> {
  try {
    const raw = await deps.callJson([
      { role: "system", content: OUTLINE_SYSTEM },
      {
        role: "user",
        content: `主题：${deps.topic}\n\n证据包：\n${deps.evidence}`,
      },
    ]);
    return parseOutlineJson(raw, deps.topic);
  } catch {
    return defaultOutline(deps.topic);
  }
}

export function buildSectionMessages(args: {
  outline: ReportOutline;
  section: ReportSection;
  sectionIndex: number;
  evidence: string;
  previousSummaries: string[];
}): Array<{ role: string; content: string }> {
  const prev =
    args.previousSummaries.length > 0
      ? `前文已写内容摘要：\n${args.previousSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "前文已写内容摘要：（无）";
  const citeHint =
    args.section.citationIndexes.length > 0
      ? `建议重点引用编号：${args.section.citationIndexes.join(", ")}`
      : "请优先引用与本节相关的证据编号。";
  return [
    { role: "system", content: SECTION_SYSTEM },
    {
      role: "user",
      content: [
        `报告标题：${args.outline.title}`,
        `当前章节（第 ${args.sectionIndex + 1}/${args.outline.sections.length}）：${args.section.title}`,
        `章节写作要点：${args.section.brief}`,
        citeHint,
        prev,
        "",
        "证据包：",
        args.evidence,
      ].join("\n"),
    },
  ];
}

/** 由各节标题生成 Markdown 目录。 */
export function renderTableOfContents(outline: ReportOutline): string {
  const lines = ["## 目录", ""];
  outline.sections.forEach((section, i) => {
    lines.push(`${i + 1}. ${section.title}`);
  });
  lines.push("");
  return lines.join("\n");
}

const CITATION_TOKEN_RE = /\[(\d{1,3})\](?!\()/g;

/**
 * 把正文中的 [N] 替换为 Markdown 链接 [N](#ref-N)。
 * 只替换 citations 中真实存在的编号；不存在的编号保持纯文本。
 * 已经是链接形式的 [N](...) 不重复处理。代码围栏内不替换。
 */
export function linkifyCitations(markdown: string, validIndexes: Set<number>): string {
  if (!markdown || validIndexes.size === 0) return markdown;
  const parts = markdown.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      return part.replace(CITATION_TOKEN_RE, (full, digits: string) => {
        const n = Number(digits);
        if (!Number.isInteger(n) || !validIndexes.has(n)) return full;
        return `[${n}](#ref-${n})`;
      });
    })
    .join("");
}

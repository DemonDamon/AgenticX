/**
 * Sectioned long-form report writing for deep research.
 * outline → per-section stream → join, to bypass single-completion max_tokens.
 */

import { EVIDENCE_DISCIPLINE_HINT } from "../retrieval/evidence-discipline";
import { UNTRUSTED_EVIDENCE_SYSTEM_HINT } from "./evidence-pack";
import { parseLlmJson } from "./llm-json";
import {
  isMarkdownFenceLine,
  isMarkdownHeadingLine,
  isMarkdownTableDividerLine,
  splitMarkdownSentences,
} from "./markdown-structure";

export const MIN_SECTIONS = 5;
export const MAX_SECTIONS = 9;
export const SECTION_TARGET_CHARS = 1_500;

export type SectionFormat =
  | "prose"
  | "comparison_table"
  | "timeline"
  | "mermaid"
  | "tradeoff";

export type SectionSemanticRole =
  | "core"
  | "evidence"
  | "mechanism"
  | "outcome"
  | "boundary"
  | "decision"
  | "limitations"
  | "internal_meta"
  | "custom";

const FORMAT_SET = new Set<SectionFormat>([
  "prose",
  "comparison_table",
  "timeline",
  "mermaid",
  "tradeoff",
]);

const SEMANTIC_ROLE_SET = new Set<SectionSemanticRole>([
  "core",
  "evidence",
  "mechanism",
  "outcome",
  "boundary",
  "decision",
  "limitations",
  "internal_meta",
  "custom",
]);

export type ReportSection = {
  id: string;
  /** 章节标题，不含 "##" 前缀。 */
  title: string;
  /** 该节要回答什么，写给下游写作调用看。 */
  brief: string;
  /** 该节应重点引用的证据编号。 */
  citationIndexes: number[];
  /** 本节主表达形态；缺省 prose */
  format: SectionFormat;
  /** 供章节排序、策略过滤和缺口补位使用，不从标题关键词反推。 */
  semanticRole: SectionSemanticRole;
};

export type ReportOutline = {
  title: string;
  sections: ReportSection[];
};

export type ReportContentPolicy = {
  /** 允许独立的推荐、不推荐、选型或采用建议章节。 */
  allowDecisionSections: boolean;
  /** 允许独立的局限、风险、争议或证据质量章节。 */
  allowLimitationsSections: boolean;
};

export type OutlineDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  evidence: string;
  contentPolicy: ReportContentPolicy;
};

const DEFAULT_REPORT_CONTENT_POLICY: ReportContentPolicy = {
  allowDecisionSections: false,
  allowLimitationsSections: false,
};

const DECISION_INTENT_RE =
  /推荐|不推荐|选型|怎么选|如何选择|选择哪个|是否(?:值得|应该|应当|适合)|值不值得|该不该|优缺点|利弊|取舍|trade[\s-]?off|recommend(?:ation)?|which\s+.+\s+choose|should\s+(?:i|we)|pros?\s+(?:and|&)\s+cons?/iu;
const LIMITATIONS_INTENT_RE =
  /局限(?:性)?|限制|不足|缺陷|缺点|风险|争议|不确定(?:性)?|证据(?:质量|可靠性|缺口)|信息缺口|可信度|可靠性|limitations?|drawbacks?|weakness(?:es)?|risks?|uncertaint(?:y|ies)|caveats?|confidence|reliability/iu;

export function deriveReportContentPolicy(args: {
  originalUserQuery: string;
  deliveryShapes?: readonly string[];
}): ReportContentPolicy {
  const query = args.originalUserQuery.trim();
  const decisionRequested =
    args.deliveryShapes?.includes("decision") === true || DECISION_INTENT_RE.test(query);
  return {
    allowDecisionSections: decisionRequested,
    // “决策建议”体例本身包含风险；用户主动选择后允许风险章节。
    allowLimitationsSections: decisionRequested || LIMITATIONS_INTENT_RE.test(query),
  };
}

function reportContentPolicyBlock(policy: ReportContentPolicy): string {
  return [
    "【报告内容策略】",
    policy.allowDecisionSections
      ? "- 用户明确要求决策/选型内容：允许推荐、不推荐与决策建议章节。"
      : "- 用户未要求决策/选型内容：禁止推荐、不推荐、选型建议或风险评估式决策章节。",
    policy.allowLimitationsSections
      ? "- 用户明确要求局限/风险内容：允许对应专题章节。"
      : "- 用户未要求局限/风险内容：禁止独立的信息缺口、来源置信度、检索过程或风险自评章节；影响结论的适用条件须就近写在相关结论旁。",
  ].join("\n");
}

const OUTLINE_SYSTEM = [
  "你是深度研究报告大纲助手。只输出 JSON，不要 Markdown 围栏。",
  '格式：{"title":"...","sections":[{"id":"s1","title":"...","brief":"...","citation_indexes":[1,4,7],"format":"prose","semantic_role":"core"}]}',
  `章节数 ${MIN_SECTIONS}-${MAX_SECTIONS}，按证据密度决定，宁少勿滥。`,
  "必须包含首节「核心结论」，其余章节直接回答用户问题，按结果、证据、机制和适用条件组织。",
  "format 取值：prose | comparison_table | timeline | mermaid | tradeoff",
  "semantic_role 取值：core | evidence | mechanism | outcome | boundary | decision | limitations | custom；首节必须为 core，每节只选一个最主要角色。",
  "禁止输出 internal_meta 角色；decision 与 limitations 仅在下方报告内容策略明确允许时使用。",
  "首节「核心结论」必须 format=prose。tradeoff 仅在下方报告内容策略明确允许决策章节时使用。",
  "默认禁止独立的「不确定性与信息缺口」「来源置信度」「检索过程」「研究方法自评」等内部元章节。",
  "证据限制若会改变答案，只在对应结论附近简洁说明适用边界，不得扩写成系统检索自评。",
  "中间章节按证据选择形态：对比/选型/竞品至少 1 节 comparison_table；演进/版本/时间节点至少 1 节 timeline；架构/关系/流程可用 1 节 mermaid。",
  "全篇中间节不得全部为 prose（至少 1 节为 comparison_table / timeline / mermaid / tradeoff 之一）。",
  "citation_indexes 只能引用证据包中真实存在的编号。",
  UNTRUSTED_EVIDENCE_SYSTEM_HINT,
  "使用与用户提问相同的语言。",
].join("\n");

const SECTION_SYSTEM = [
  "你是深度研究报告分节写作助手。只写当前这一节的正文，不要重复输出标题，不要写其它章节内容。",
  `目标篇幅 ≥ ${SECTION_TARGET_CHARS} 字：展开论证、给出具体数字与机制细节，禁止空话凑字。`,
  "每条事实必须以 [N] 标注，N 必须在证据包中存在，禁止编造编号。",
  UNTRUSTED_EVIDENCE_SYSTEM_HINT,
  EVIDENCE_DISCIPLINE_HINT,
  "禁止介绍内部搜索次数、来源置信度、信息缺口清单、检索过程或第一条资料是否可信。",
  "证据不足时缩小断言范围；真正影响结论的限定条件须放在对应结论旁，不得另写检索自评。",
  "若提供了「前文已写内容摘要」，避免重复已写过的表述。",
  "本节不要重复首节已给出的结论表述，聚焦本节主题的机制、数据与论证。",
  "只输出本节 Markdown 正文。",
].join("\n");

/** 首节是全文结论摘要，篇幅与体例都与分项分析不同，否则会与后文大面积重复。 */
const LEAD_SECTION_SYSTEM = [
  "你是深度研究报告首节「核心结论」写作助手。",
  "本节是全文结论摘要，不是综述：用 4–8 条要点式结论呈现最关键判断，每条 1–3 句。",
  "目标篇幅 400–800 字，禁止展开机制细节与背景铺陈——那些属于后续分项分析章节。",
  "每条结论必须以 [N] 标注支撑证据，N 必须在证据包中存在，禁止编造编号。",
  UNTRUSTED_EVIDENCE_SYSTEM_HINT,
  EVIDENCE_DISCIPLINE_HINT,
  "禁止把内部来源置信度、信息缺口清单或检索过程当作结论；必要限定条件只在其影响的结论中就近说明。",
  "只输出本节 Markdown 正文，不要重复输出标题。",
].join("\n");

const FORMAT_DIRECTIVES: Record<SectionFormat, string> = {
  prose: "表达形态 prose：以论述为主；合适处可插入小表，但不强制。",
  comparison_table:
    "表达形态 comparison_table：必须含 ≥1 张 GFM 对比表（表头+分隔行+|---|+≥3 数据行）；列含可对比维度与证据 [N]；表后可有简短解读；禁止用纯列表代替表。",
  timeline:
    "表达形态 timeline：必须用 GFM 表或有序时间线列出 ≥4 个带时间/版本节点的事件，每行带 [N]。",
  mermaid:
    "表达形态 mermaid：必须含一个 ```mermaid 代码块（flowchart 或 mindmap）；节点标签短；图后 3–6 句解读；禁止只写「如下图所示」而无代码块。",
  tradeoff:
    "表达形态 tradeoff：必须含「方案 × 维度」GFM 对比表，并另起一段写清推荐/不推荐/风险。",
};

function defaultOutline(
  fallbackTitle: string,
  policy: ReportContentPolicy = DEFAULT_REPORT_CONTENT_POLICY,
): ReportOutline {
  const finalSection: ReportSection = policy.allowDecisionSections
    ? {
        id: "s5",
        title: "比较结论与决策建议",
        brief: "基于前述证据说明选择条件、推荐与风险",
        citationIndexes: [],
        format: "tradeoff",
        semanticRole: "decision",
      }
    : policy.allowLimitationsSections
      ? {
          id: "s5",
          title: "局限、风险与适用边界",
          brief: "说明会实质影响结论的限制、风险与适用条件",
          citationIndexes: [],
          format: "prose",
          semanticRole: "limitations",
        }
      : {
          id: "s5",
          title: "综合判断与适用范围",
          brief: "综合前述结果，说明结论成立的条件和实际适用范围",
          citationIndexes: [],
          format: "prose",
          semanticRole: "boundary",
        };
  return {
    title: fallbackTitle || "调研报告",
    sections: [
      {
        id: "s1",
        title: "核心结论",
        brief: "概括主题核心发现与判断",
        citationIndexes: [],
        format: "prose",
        semanticRole: "core",
      },
      {
        id: "s2",
        title: "关键表现与证据",
        brief: "围绕用户问题呈现关键表现与直接证据。请用 Markdown 对比表呈现关键维度",
        citationIndexes: [],
        format: "comparison_table",
        semanticRole: "evidence",
      },
      {
        id: "s3",
        title: "机制与因果解释",
        brief: "解释关键结果由何种机制、条件或实现路径造成",
        citationIndexes: [],
        format: "prose",
        semanticRole: "mechanism",
      },
      {
        id: "s4",
        title: "实际结果与边界条件",
        brief: "结合具体案例或数据说明实际结果，以及结论适用和不适用的条件",
        citationIndexes: [],
        format: "prose",
        semanticRole: "outcome",
      },
      finalSection,
    ],
  };
}

function normalizeFormat(raw: unknown): SectionFormat {
  if (typeof raw === "string" && FORMAT_SET.has(raw as SectionFormat)) {
    return raw as SectionFormat;
  }
  return "prose";
}

function normalizeSemanticRole(
  raw: unknown,
  index: number,
): SectionSemanticRole {
  if (
    typeof raw === "string" &&
    SEMANTIC_ROLE_SET.has(raw as SectionSemanticRole)
  ) {
    return raw as SectionSemanticRole;
  }
  // Rolling compatibility with outlines generated before semantic_role existed.
  return index === 0 ? "core" : "custom";
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
  return {
    id,
    title,
    brief,
    citationIndexes,
    format: normalizeFormat(obj.format),
    semanticRole: normalizeSemanticRole(
      obj.semantic_role ?? obj.semanticRole,
      index,
    ),
  };
}

const LEGACY_INTERNAL_META_GUARD_RE =
  /不确定性与信息缺口|信息缺口|证据缺口|来源置信度|证据置信度|资料完整性|检索过程|搜索过程|调研过程|研究方法自评|证据质量评估|information\s+gaps?|source\s+confidence|research\s+methodology|search\s+process/iu;
const LEGACY_DECISION_GUARD_RE =
  /推荐|不推荐|决策建议|采用建议|选型建议|风险评估|recommend(?:ation)?|risk\s+assessment|decision/iu;

/**
 * Prompt 不是安全边界：模型返回元章节或未请求的决策体例时，
 * 在进入分节写作前确定性过滤/归一化。
 */
export function applyReportContentPolicy(
  outline: ReportOutline,
  policy: ReportContentPolicy = DEFAULT_REPORT_CONTENT_POLICY,
): ReportOutline {
  const sections = outline.sections.flatMap((section): ReportSection[] => {
    const combined = `${section.title} ${section.brief}`;
    const legacyGuardText =
      section.semanticRole === "custom" ? combined : section.title;
    if (section.semanticRole === "internal_meta") return [];
    if (
      !policy.allowLimitationsSections &&
      (section.semanticRole === "limitations" ||
        LEGACY_INTERNAL_META_GUARD_RE.test(legacyGuardText))
    ) {
      return [];
    }
    if (
      !policy.allowDecisionSections &&
      (section.semanticRole === "decision" ||
        (section.semanticRole !== "limitations" &&
          LEGACY_DECISION_GUARD_RE.test(legacyGuardText)))
    ) {
      return [];
    }

    let next = section;
    if (!policy.allowDecisionSections && next.format === "tradeoff") {
      next = { ...next, format: "comparison_table" };
    }

    return [next];
  });

  if (sections.length === 0) return defaultOutline(outline.title, policy);
  return ensureMinimumOutlineSections({ ...outline, sections }, policy);
}

function sectionPurpose(section: ReportSection): string {
  return section.semanticRole === "custom"
    ? `custom:${section.title.normalize("NFKC").toLocaleLowerCase("en-US")}`
    : section.semanticRole;
}

/**
 * Enforce the 5–9 section delivery contract after policy filtering. Missing
 * sections are filled with distinct result/evidence/mechanism/outcome/boundary
 * duties instead of generic filler or internal research-process commentary.
 */
export function ensureMinimumOutlineSections(
  outline: ReportOutline,
  policy: ReportContentPolicy = DEFAULT_REPORT_CONTENT_POLICY,
): ReportOutline {
  const defaults = defaultOutline(outline.title, policy).sections;
  const deduped: ReportSection[] = [];
  const seenTitles = new Set<string>();
  for (const section of outline.sections.slice(0, MAX_SECTIONS)) {
    const key = section.title.normalize("NFKC").toLocaleLowerCase("en-US").trim();
    if (!key || seenTitles.has(key)) continue;
    seenTitles.add(key);
    deduped.push(section);
  }

  const coreIndex = deduped.findIndex((section) => sectionPurpose(section) === "core");
  if (coreIndex < 0) {
    deduped.unshift(defaults[0]!);
  } else if (coreIndex > 0) {
    const [core] = deduped.splice(coreIndex, 1);
    if (core) deduped.unshift(core);
  }
  if (deduped[0]) deduped[0] = { ...deduped[0], format: "prose" };

  const purposes = new Set(deduped.map(sectionPurpose));
  for (const fallback of defaults) {
    if (deduped.length >= MIN_SECTIONS) break;
    const purpose = sectionPurpose(fallback);
    if (purposes.has(purpose)) continue;
    deduped.push(fallback);
    purposes.add(purpose);
  }
  // A highly unusual custom outline can occupy every semantic bucket while
  // still containing fewer than five unique titles. Fill from unused defaults.
  for (const fallback of defaults) {
    if (deduped.length >= MIN_SECTIONS) break;
    if (deduped.some((section) => section.title === fallback.title)) continue;
    deduped.push(fallback);
  }

  const usedIds = new Set<string>();
  const sections = deduped.slice(0, MAX_SECTIONS).map((section, index) => {
    const requestedId = section.id.trim();
    let id = requestedId && !usedIds.has(requestedId) ? requestedId : `s${index + 1}`;
    let suffix = index + 1;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `s${suffix}`;
    }
    usedIds.add(id);
    return { ...section, id };
  });
  return ensureRichOutlineFormats({ ...outline, sections });
}

/** 中间节不得全是 prose：否则把第二节强制改为 comparison_table。 */
export function ensureRichOutlineFormats(outline: ReportOutline): ReportOutline {
  if (outline.sections.length < 3) return outline;
  const middle = outline.sections.slice(1, -1);
  if (middle.length === 0) return outline;
  if (middle.some((s) => s.format !== "prose")) return outline;

  const targetIndex = 1;
  const sections = outline.sections.map((section, i) => {
    if (i !== targetIndex) return section;
    const brief = section.brief.includes("请用 Markdown 对比表")
      ? section.brief
      : `${section.brief.replace(/。$/, "")}。请用 Markdown 对比表呈现关键维度`;
    return { ...section, format: "comparison_table" as const, brief };
  });
  return { ...outline, sections };
}

export function parseOutlineJson(
  raw: string,
  fallbackTitle: string,
  policy: ReportContentPolicy = DEFAULT_REPORT_CONTENT_POLICY,
): ReportOutline {
  const fallback = defaultOutline(fallbackTitle, policy);
  const parsed = parseLlmJson<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== "object") return fallback;

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
  return applyReportContentPolicy({ title, sections }, policy);
}

export async function buildReportOutline(deps: OutlineDeps): Promise<ReportOutline> {
  try {
    const raw = await deps.callJson([
      { role: "system", content: OUTLINE_SYSTEM },
      {
        role: "user",
        content: [
          `主题：${deps.topic}`,
          reportContentPolicyBlock(deps.contentPolicy),
          "证据包：",
          deps.evidence,
        ].join("\n\n"),
      },
    ]);
    return parseOutlineJson(raw, deps.topic, deps.contentPolicy);
  } catch {
    return defaultOutline(deps.topic, deps.contentPolicy);
  }
}

/** Per-section continuity memory; nine of these must still fit one prompt. */
export const MAX_SECTION_CONTINUITY_CHARS = 420;
export const MAX_REPORT_CONTINUITY_CHARS = 4_000;
const MAX_CONTINUITY_CLAIMS = 3;

/** Fresh instance per scan: a shared global regex carries lastIndex across calls. */
const continuityCitationRe = () => /\[(\d{1,3})\]/gu;
const HAS_CONTINUITY_CITATION_RE = /\[\d{1,3}\]/u;

/** Drop code, headings and table rules; keep readable statements in order. */
function continuityStatements(body: string): string[] {
  const statements: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (isMarkdownFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isMarkdownHeadingLine(line)) continue;
    if (isMarkdownTableDividerLine(line)) continue;
    const text = line.replace(/^\s*(?:[-*+]|\d{1,3}[.)]|>)\s*/u, "").trim();
    if (!text) continue;
    for (const piece of splitMarkdownSentences(text)) {
      const statement = piece.trim();
      // Short enough to be a fragment ("是的。", "见下表") carries no conclusion.
      if (statement.length >= 4) statements.push(statement);
    }
  }
  return statements;
}

/** Evenly spaced picks so the end of a long section is never dropped. */
function spreadPick<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.round((i * (items.length - 1)) / (count - 1));
    const item = items[at];
    if (item !== undefined && !picked.includes(item)) picked.push(item);
  }
  return picked;
}

/**
 * Deterministic cross-section memory.
 *
 * A flat `slice(0, 200)` of the section body kept only its opening paragraph, so
 * the conclusion of a 2,000-character chapter never reached the next section and
 * later chapters happily re-derived or contradicted it. This keeps the cited
 * conclusions instead, and never costs a model call.
 */
export function buildSectionContinuitySummary(title: string, body: string): string {
  const statements = continuityStatements(body);
  if (statements.length === 0) return "";

  const cited = statements.filter((statement) =>
    HAS_CONTINUITY_CITATION_RE.test(statement),
  );
  const chosen =
    cited.length > 0
      ? spreadPick(cited, MAX_CONTINUITY_CLAIMS)
      : spreadPick(
          statements.length > 1 ? [statements[0]!, statements[statements.length - 1]!] : statements,
          2,
        );

  const usedCitations: string[] = [];
  for (const statement of chosen) {
    for (const match of statement.matchAll(continuityCitationRe())) {
      const marker = `[${match[1]}]`;
      if (!usedCitations.includes(marker)) usedCitations.push(marker);
    }
  }

  const header = `【${title.trim() || "本节"}】`;
  const lines = [header, "关键结论："];
  let used = lines.join("\n").length;
  for (const statement of chosen) {
    const line = `- ${statement}`;
    if (used + line.length + 1 > MAX_SECTION_CONTINUITY_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 2) {
    // Nothing fit under the cap: keep a truncated first statement over nothing.
    lines.push(`- ${chosen[0]!.slice(0, Math.max(0, MAX_SECTION_CONTINUITY_CHARS - used - 3))}`);
    used = lines.join("\n").length;
  }
  if (usedCitations.length > 0) {
    const sourcesLine = `已用来源：${usedCitations.join("")}`;
    if (used + sourcesLine.length + 1 <= MAX_SECTION_CONTINUITY_CHARS) {
      lines.push(sourcesLine);
    }
  }
  return lines.join("\n").slice(0, MAX_SECTION_CONTINUITY_CHARS);
}

/** Newest-first trim so the immediately preceding section always survives. */
export function boundReportContinuity(
  summaries: readonly string[],
  maxChars = MAX_REPORT_CONTINUITY_CHARS,
): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let i = summaries.length - 1; i >= 0; i -= 1) {
    const summary = summaries[i]!;
    if (used + summary.length + 1 > maxChars) break;
    kept.unshift(summary);
    used += summary.length + 1;
  }
  return kept;
}

export function buildSectionMessages(args: {
  outline: ReportOutline;
  section: ReportSection;
  sectionIndex: number;
  evidence: string;
  previousSummaries: string[];
  contentPolicy?: ReportContentPolicy;
}): Array<{ role: string; content: string }> {
  const bounded = boundReportContinuity(args.previousSummaries);
  const prev =
    bounded.length > 0
      ? `前文已写内容摘要：\n${bounded.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "前文已写内容摘要：（无）";
  const citeHint =
    args.section.citationIndexes.length > 0
      ? `建议重点引用编号：${args.section.citationIndexes.join(", ")}`
      : "请优先引用与本节相关的证据编号。";
  const isLead = args.sectionIndex === 0;
  const format = args.section.format;
  const formatLine = isLead ? null : FORMAT_DIRECTIVES[format] ?? FORMAT_DIRECTIVES.prose;
  return [
    {
      role: "system",
      content: isLead ? LEAD_SECTION_SYSTEM : SECTION_SYSTEM,
    },
    {
      role: "user",
      content: [
        `报告标题：${args.outline.title}`,
        `当前章节（第 ${args.sectionIndex + 1}/${args.outline.sections.length}）：${args.section.title}`,
        `章节写作要点：${args.section.brief}`,
        isLead ? null : `本节表达形态：${format}`,
        formatLine,
        reportContentPolicyBlock(args.contentPolicy ?? DEFAULT_REPORT_CONTENT_POLICY),
        citeHint,
        prev,
        "",
        "证据包：",
        args.evidence,
      ]
        .filter((line): line is string => line != null && line !== "")
        .join("\n"),
    },
  ];
}

export function buildSectionFormatRepairMessages(args: {
  section: ReportSection;
  body: string;
  contentPolicy?: ReportContentPolicy;
}): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是报告章节结构修复助手。只重排下方现有正文，使其满足指定 Markdown 形态。",
        "不得添加正文中没有的新事实、数字、引用编号或结论；保留原有 [N] 引用；不要输出章节标题。",
        "不要解释修复过程，只输出修复后的完整章节正文。",
        UNTRUSTED_EVIDENCE_SYSTEM_HINT,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `章节：${args.section.title}`,
        `目标形态：${args.section.format}`,
        FORMAT_DIRECTIVES[args.section.format],
        reportContentPolicyBlock(args.contentPolicy ?? DEFAULT_REPORT_CONTENT_POLICY),
        "",
        "【待结构修复的原正文】",
        args.body,
      ].join("\n"),
    },
  ];
}

function gfmTableDataRows(body: string): number {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length - 1; i += 1) {
    const row = (lines[i] ?? "").trim();
    const sep = (lines[i + 1] ?? "").trim();
    if (!/^\|.+\|$/.test(row) || !/^\|[\s|:-]+\|$/.test(sep)) continue;
    let dataRows = 0;
    for (let j = i + 2; j < lines.length; j += 1) {
      if (!/^\|.+\|$/.test((lines[j] ?? "").trim())) break;
      dataRows += 1;
    }
    return dataRows;
  }
  return 0;
}

function hasGfmTable(body: string, minimumRows = 1): boolean {
  return gfmTableDataRows(body) >= minimumRows;
}

function hasTimelineHeuristic(body: string): boolean {
  if (hasGfmTable(body, 4)) return true;
  const bullets = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^\s*([-*]|\d+\.)\s+/.test(line));
  return bullets.length >= 4;
}

function hasMermaidFence(body: string): boolean {
  return /```mermaid[\s\S]*?```/i.test(body);
}

/** Deterministic structure validation used by the orchestrator repair pass. */
export function sectionMeetsFormat(section: ReportSection, body: string): boolean {
  switch (section.format) {
    case "prose":
      return body.trim().length > 0;
    case "comparison_table":
    case "tradeoff":
      return hasGfmTable(body, 3);
    case "timeline":
      return hasTimelineHeuristic(body);
    case "mermaid":
      return hasMermaidFence(body);
    default: {
      const _exhaustive: never = section.format;
      void _exhaustive;
      return true;
    }
  }
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

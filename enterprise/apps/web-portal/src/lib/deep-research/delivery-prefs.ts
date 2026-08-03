/**
 * Deep-research delivery preferences: clarify questions + parse helpers.
 */

import type { ClarifyQuestion } from "./clarifier";

export type DeliveryFormat = "md" | "html" | "docx" | "pdf";
export type DeliveryShapeId = "structured" | "matrix" | "viz" | "decision";

export type DeliveryPrefs = {
  shapes: DeliveryShapeId[];
  format: DeliveryFormat;
};

export const DELIVERY_SHAPE_QUESTION_ID = "q_delivery_shape";
export const DELIVERY_FORMAT_QUESTION_ID = "q_delivery_format";

export const DEFAULT_DELIVERY_PREFS: DeliveryPrefs = {
  shapes: ["structured"],
  format: "md",
};

const SHAPE_OPTIONS: Array<{ id: DeliveryShapeId; label: string }> = [
  { id: "structured", label: "结构化报告——完整论证链" },
  { id: "matrix", label: "对比矩阵 / 时间线——一眼看清关键差异" },
  { id: "viz", label: "数据可视化——趋势与结构关系（图表 / 图示）" },
  { id: "decision", label: "决策建议——推荐什么、不推荐什么、风险在哪" },
];

const FORMAT_OPTIONS: Array<{ id: DeliveryFormat; label: string }> = [
  { id: "md", label: "Markdown（.md）" },
  { id: "html", label: "可视化网页（.html）" },
  { id: "docx", label: "Word（.doc）" },
  { id: "pdf", label: "PDF（打印导出）" },
];

const SHAPE_LABELS: Record<DeliveryShapeId, string> = {
  structured: "结构化报告",
  matrix: "对比矩阵/时间线",
  viz: "数据可视化",
  decision: "决策建议",
};

const FORMAT_LABELS: Record<DeliveryFormat, string> = {
  md: "Markdown（md）",
  html: "可视化网页（html）",
  docx: "Word（docx）",
  pdf: "PDF（打印导出）",
};

export function deliveryClarifyQuestions(): ClarifyQuestion[] {
  return [
    {
      id: DELIVERY_SHAPE_QUESTION_ID,
      question: "调研结果希望以哪些内容形态呈现？（可多选）",
      options: SHAPE_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
      allowCustom: false,
      multiSelect: true,
    },
    {
      id: DELIVERY_FORMAT_QUESTION_ID,
      question: "最终主交付格式？（请选一个）",
      options: FORMAT_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
      allowCustom: false,
      multiSelect: false,
    },
  ];
}

export function isDeliveryClarifyQuestionId(id: string): boolean {
  return id === DELIVERY_SHAPE_QUESTION_ID || id === DELIVERY_FORMAT_QUESTION_ID;
}

/** Longest-label-first match; return ids in original options order. */
function matchOptionIds(
  answer: string,
  options: Array<{ id: string; label: string }>,
): string[] {
  const text = answer.trim();
  if (!text || options.length === 0) return [];
  const sorted = [...options].sort((a, b) => b.label.length - a.label.length);
  const hit = new Set<string>();
  let remaining = text;
  for (const opt of sorted) {
    const label = opt.label.trim();
    if (!label) continue;
    const at = remaining.indexOf(label);
    if (at < 0) continue;
    hit.add(opt.id);
    remaining = `${remaining.slice(0, at)}\0${remaining.slice(at + label.length)}`;
  }
  return options.map((o) => o.id).filter((id) => hit.has(id));
}

export function parseDeliveryPrefs(
  answers: Record<string, string>,
  questions: ClarifyQuestion[] = deliveryClarifyQuestions(),
): DeliveryPrefs {
  const shapeQ =
    questions.find((q) => q.id === DELIVERY_SHAPE_QUESTION_ID) ??
    deliveryClarifyQuestions()[0]!;
  const formatQ =
    questions.find((q) => q.id === DELIVERY_FORMAT_QUESTION_ID) ??
    deliveryClarifyQuestions()[1]!;

  const shapeAnswer = answers[DELIVERY_SHAPE_QUESTION_ID]?.trim() ?? "";
  const formatAnswer = answers[DELIVERY_FORMAT_QUESTION_ID]?.trim() ?? "";

  const shapeIds = matchOptionIds(shapeAnswer, shapeQ.options).filter(
    (id): id is DeliveryShapeId =>
      id === "structured" || id === "matrix" || id === "viz" || id === "decision",
  );

  let formatIds = matchOptionIds(formatAnswer, formatQ.options).filter(
    (id): id is DeliveryFormat =>
      id === "md" || id === "html" || id === "docx" || id === "pdf",
  );

  // Loose fallback when labels drift (half-width parens / option id / keyword).
  if (formatIds.length === 0 && formatAnswer) {
    const lower = formatAnswer.toLowerCase();
    if (
      lower === "html" ||
      lower.includes("可视化网页") ||
      lower.includes(".html")
    ) {
      formatIds = ["html"];
    } else if (lower === "pdf" || lower.includes("打印")) {
      formatIds = ["pdf"];
    } else if (lower === "docx" || lower.includes("word") || lower.includes(".doc")) {
      formatIds = ["docx"];
    } else if (lower === "md" || lower.includes("markdown") || lower.includes(".md")) {
      formatIds = ["md"];
    }
  }

  return {
    shapes: shapeIds.length > 0 ? shapeIds : [...DEFAULT_DELIVERY_PREFS.shapes],
    format: formatIds[0] ?? DEFAULT_DELIVERY_PREFS.format,
  };
}

export function deliveryPrefsPromptBlock(prefs: DeliveryPrefs): string {
  const shapes = prefs.shapes.map((id) => SHAPE_LABELS[id]).join("、");
  const format = FORMAT_LABELS[prefs.format];
  return [
    "【交付偏好】",
    `- 内容形态：${shapes || SHAPE_LABELS.structured}`,
    `- 主格式：${format}`,
    "写作时优先满足上述形态；完整论证链不可省略核心结论与信息缺口。",
  ].join("\n");
}

export function primaryReportPathSuffix(prefs: DeliveryPrefs): "final-report.md" | "report.html" {
  if (prefs.format === "html" || prefs.format === "pdf") return "report.html";
  return "final-report.md";
}

export function shouldEmphasizeHtmlArtifact(prefs: DeliveryPrefs): boolean {
  return prefs.format === "html" || prefs.format === "pdf";
}

/** Human title for the primary delivery card (no · 终稿 noise). */
export function primaryArtifactTitle(topic: string, prefs: DeliveryPrefs): string {
  const base = sanitizeResearchTopic(topic);
  if (prefs.format === "html" || prefs.format === "pdf") {
    return `${base}.html`;
  }
  return `${base}.md`;
}

/**
 * Strip clarify / delivery-preference meta blocks from a topic or outline title.
 * These belong in planner prompts only — never in final-report.md headings.
 */
export function sanitizeResearchTopic(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "调研报告";
  // Drop from the first meta marker (multiline block or inline suffix).
  const cut = text.search(/【(?:用户澄清|交付偏好)】/);
  if (cut >= 0) text = text.slice(0, cut).trim();
  // Planner sometimes keeps a trailing colon / punctuation from the cut.
  text = text.replace(/[:：\-\s]+$/u, "").trim();
  return text || "调研报告";
}

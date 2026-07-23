/**
 * Strip model-authored citation legend blocks from assistant markdown:
 * 「数据来源标注」and「关键引用」.
 *
 * - 数据来源标注: epistemic labels (not clickable provenance) — strip and discard
 *   from body so `[N]` does not collide with citation pills.
 * - 关键引用: quote bibliography — strip from body (avoids broken inline-list
 *   rendering) but return structured items for a dedicated UI block.
 */

export type SourceAttributionKind = "verified" | "inference" | "hypothesis" | "other";

export type SourceAttributionItem = {
  kind: SourceAttributionKind;
  /** Short UI label, e.g. 已验证 / 合理推测 */
  label: string;
  text: string;
};

/** One row under「关键引用」— keeps English quotes for a dedicated render block. */
export type KeyCitationItem = {
  /** Marker id from `[N]`, or null when the model omitted it. */
  id: number | null;
  text: string;
};

export type LegendKind = "source-attribution" | "key-citations";

export type SourceAttributionExtract = {
  body: string;
  /** 数据来源标注 rows (not shown in UI today). */
  items: SourceAttributionItem[];
  /** 关键引用 rows — re-rendered below the body with unified styling. */
  keyCitations: KeyCitationItem[];
  legendKind: LegendKind | null;
};

const SOURCE_ATTRIBUTION_HEADING_RE =
  /^(?:>\s*){0,3}(?:#{1,6}\s*)?(?:\*\*)?数据来源标注(?:\*\*)?\s*[：:.．]?\s*$/u;

const KEY_CITATIONS_HEADING_RE =
  /^(?:>\s*){0,3}(?:#{1,6}\s*)?(?:\*\*)?关键引用(?:\*\*)?\s*[：:.．]?\s*$/u;

const KIND_PATTERNS: Array<{
  kind: SourceAttributionKind;
  label: string;
  re: RegExp;
}> = [
  {
    kind: "verified",
    label: "已验证",
    re: /^(?:已验证数据|已验证|Verified)\s*[：:]\s*(.+)$/iu,
  },
  {
    kind: "inference",
    label: "合理推测",
    re: /^(?:合理推测|推测|Inference)\s*[：:]\s*(.+)$/iu,
  },
  {
    kind: "hypothesis",
    label: "纯假设",
    re: /^(?:纯假设|假设|Hypothesis)\s*[：:]\s*(.+)$/iu,
  },
];

const LIST_ITEM_RE =
  /^(?:>\s*){0,3}(?:-\s|\*\s|\d+\.\s)(?:\[(\d+)\]\s*)?(.+?)\s*$/u;

/** GFM thematic break — must not be parsed as a bullet row (`---` → `-` + `--`). */
const THEMATIC_BREAK_RE = /^-{3,}$/u;

function stripBlockquotePrefix(line: string): string {
  return line.replace(/^(?:>\s*)+/u, "").trimEnd();
}

type ParsedLegendRow = {
  citationId: number | null;
  attribution: SourceAttributionItem | null;
  text: string;
};

function parseLegendRow(rawLine: string): ParsedLegendRow | null {
  const stripped = stripBlockquotePrefix(rawLine).trim();
  if (!stripped) return null;

  const listMatch = stripped.match(LIST_ITEM_RE);
  if (!listMatch) return null;

  const citationId = listMatch[1] ? Number(listMatch[1]) : null;
  let payload = (listMatch[2] ?? "").trim();
  // Also tolerate `[N]` left inside the payload when the bullet had no marker group.
  const leadingCite = payload.match(/^\[(\d+)\]\s*(.+)$/u);
  let id = citationId;
  if (leadingCite) {
    id = Number(leadingCite[1]);
    payload = leadingCite[2].trim();
  }
  if (!payload) return null;

  for (const rule of KIND_PATTERNS) {
    const m = payload.match(rule.re);
    if (m?.[1]) {
      return {
        citationId: id,
        attribution: { kind: rule.kind, label: rule.label, text: m[1].trim() },
        text: m[1].trim(),
      };
    }
  }

  return {
    citationId: id,
    attribution: { kind: "other", label: "", text: payload },
    text: payload,
  };
}

function detectLegendKind(line: string): LegendKind | null {
  const trimmed = stripBlockquotePrefix(line).trim();
  if (SOURCE_ATTRIBUTION_HEADING_RE.test(trimmed)) return "source-attribution";
  if (KEY_CITATIONS_HEADING_RE.test(trimmed)) return "key-citations";
  return null;
}

function isLegendHeadingLine(line: string): boolean {
  return detectLegendKind(line) != null;
}

/**
 * Pull the trailing (or last) 数据来源标注 / 关键引用 block out of assistant markdown.
 * Returns original content unchanged when no parseable items are found.
 */
export function extractSourceAttribution(content: string): SourceAttributionExtract {
  const empty: SourceAttributionExtract = {
    body: content,
    items: [],
    keyCitations: [],
    legendKind: null,
  };
  if (!content) return empty;

  const lines = content.split("\n");
  let headingIdx = -1;
  let legendKind: LegendKind | null = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const kind = detectLegendKind(lines[i] ?? "");
    if (kind) {
      headingIdx = i;
      legendKind = kind;
      break;
    }
  }
  if (headingIdx < 0 || !legendKind) return empty;

  const rows: ParsedLegendRow[] = [];
  let endIdx = headingIdx;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = stripBlockquotePrefix(line).trim();
    if (!trimmed) {
      // Allow a blank line inside the block; stop on a second blank after items.
      if (rows.length > 0 && i + 1 < lines.length) {
        const next = stripBlockquotePrefix(lines[i + 1] ?? "").trim();
        if (!next) break;
      }
      endIdx = i;
      continue;
    }
    if (THEMATIC_BREAK_RE.test(trimmed)) break;
    // Stop if a new markdown heading begins (not part of the legend).
    if (/^#{1,6}\s+\S/u.test(trimmed) && !isLegendHeadingLine(line)) break;
    const row = parseLegendRow(line);
    if (!row) break;
    rows.push(row);
    endIdx = i;
  }

  if (rows.length === 0) return empty;

  const bodyLines = [...lines.slice(0, headingIdx), ...lines.slice(endIdx + 1)];
  const body = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();

  if (legendKind === "key-citations") {
    return {
      body,
      items: [],
      keyCitations: rows.map((r) => ({ id: r.citationId, text: r.text })),
      legendKind,
    };
  }

  return {
    body,
    items: rows.map((r) => r.attribution!).filter(Boolean),
    keyCitations: [],
    legendKind,
  };
}

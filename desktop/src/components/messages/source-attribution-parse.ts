/**
 * Strip model-authored「数据来源标注」legends from assistant markdown.
 * These blocks are epistemic labels, not clickable provenance — rendering them
 * as a second source list adds no value next to ReferencesCard / [N] pills, and
 * leaving `[N]` inside them collides with real citation badges.
 */

export type SourceAttributionKind = "verified" | "inference" | "hypothesis" | "other";

export type SourceAttributionItem = {
  kind: SourceAttributionKind;
  /** Short UI label, e.g. 已验证 / 合理推测 */
  label: string;
  text: string;
};

export type SourceAttributionExtract = {
  body: string;
  items: SourceAttributionItem[];
};

const HEADING_LINE_RE =
  /^(?:>\s*){0,3}(?:#{1,6}\s*)?(?:\*\*)?数据来源标注(?:\*\*)?\s*[：:.．]?\s*$/u;

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
  /^(?:>\s*){0,3}(?:[-*]|\d+\.)\s*(?:\[\d+\]\s*)?(.+?)\s*$/u;

function stripBlockquotePrefix(line: string): string {
  return line.replace(/^(?:>\s*)+/u, "").trimEnd();
}

function parseItemLine(rawLine: string): SourceAttributionItem | null {
  const stripped = stripBlockquotePrefix(rawLine).trim();
  if (!stripped) return null;

  const listMatch = stripped.match(LIST_ITEM_RE);
  const payload = (listMatch?.[1] ?? stripped).replace(/^\[\d+\]\s*/u, "").trim();
  if (!payload) return null;

  for (const rule of KIND_PATTERNS) {
    const m = payload.match(rule.re);
    if (m?.[1]) {
      return { kind: rule.kind, label: rule.label, text: m[1].trim() };
    }
  }

  // Bare list row under the heading — keep as unlabeled note.
  if (listMatch) {
    return { kind: "other", label: "", text: payload };
  }
  return null;
}

function isHeadingLine(line: string): boolean {
  return HEADING_LINE_RE.test(stripBlockquotePrefix(line).trim());
}

/**
 * Pull the trailing (or last) 数据来源标注 block out of assistant markdown.
 * Returns original content unchanged when no parseable items are found.
 */
export function extractSourceAttribution(content: string): SourceAttributionExtract {
  if (!content) return { body: content, items: [] };

  const lines = content.split("\n");
  let headingIdx = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isHeadingLine(lines[i] ?? "")) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx < 0) return { body: content, items: [] };

  const items: SourceAttributionItem[] = [];
  let endIdx = headingIdx;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = stripBlockquotePrefix(line).trim();
    if (!trimmed) {
      // Allow a blank line inside the block; stop on a second blank after items.
      if (items.length > 0 && i + 1 < lines.length) {
        const next = stripBlockquotePrefix(lines[i + 1] ?? "").trim();
        if (!next) break;
      }
      endIdx = i;
      continue;
    }
    // Stop if a new markdown heading begins (not part of the legend).
    if (/^#{1,6}\s+\S/u.test(trimmed) && !isHeadingLine(line)) break;
    // Stop on non-blockquote prose that is not a list/item we understand.
    const item = parseItemLine(line);
    if (!item) break;
    items.push(item);
    endIdx = i;
  }

  if (items.length === 0) return { body: content, items: [] };

  const bodyLines = [...lines.slice(0, headingIdx), ...lines.slice(endIdx + 1)];
  const body = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return { body, items };
}

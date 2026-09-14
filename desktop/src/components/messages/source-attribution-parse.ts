/**
 * Strip model-authored citation legend blocks from assistant markdown:
 * 「数据来源标注」、「关键引用」, and trailing `Sources:` / 「来源」 bibliographies.
 *
 * - 数据来源标注: epistemic labels (not clickable provenance) — strip and discard
 *   from body so `[N]` does not collide with citation pills.
 * - 关键引用: quote bibliography — strip from body (avoids broken inline-list
 *   rendering) but return structured items for a dedicated UI block.
 * - Sources / 来源: model-authored title+URL dump — strip from body and return
 *   structured rows so Desktop can render the portal-style sources list.
 */

import { i18n } from "../../i18n/i18n";
import type { SearchReference } from "../../types/search-references";
import { hostnameFromUrlOrDomain } from "../../utils/favicon-url";

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

export type LegendKind = "source-attribution" | "key-citations" | "sources-bibliography";

/** One row under a trailing `Sources:` / 「来源」 bibliography. */
export type BibliographyItem = {
  id: number | null;
  title: string;
  url: string;
};

export type SourceAttributionExtract = {
  body: string;
  /** 数据来源标注 rows (not shown in UI today). */
  items: SourceAttributionItem[];
  /** 关键引用 rows — re-rendered below the body with unified styling. */
  keyCitations: KeyCitationItem[];
  /** Sources / 来源 bibliography — re-rendered as the portal-style sources card. */
  bibliography: BibliographyItem[];
  legendKind: LegendKind | null;
};

const SOURCE_ATTRIBUTION_HEADING_RE =
  /^(?:>\s*){0,3}(?:#{1,6}\s*)?(?:\*\*)?数据来源标注(?:\*\*)?\s*[：:.．]?\s*$/u;

const KEY_CITATIONS_HEADING_RE =
  /^(?:>\s*){0,3}(?:#{1,6}\s*)?(?:\*\*)?关键引用(?:\*\*)?\s*[：:.．]?\s*$/u;

const SOURCES_BIBLIOGRAPHY_HEADING_RE =
  /^(?:>\s*){0,3}(?:#{1,6}\s*)?(?:\*\*)?(?:Sources?|来源|参考文献|参考来源|引用来源)(?:\*\*)?\s*[：:.．]?\s*$/iu;

const KIND_PATTERNS: Array<{
  kind: SourceAttributionKind;
  re: RegExp;
}> = [
  {
    kind: "verified",
    re: /^(?:已验证数据|已验证|Verified)\s*[：:]\s*(.+)$/iu,
  },
  {
    kind: "inference",
    re: /^(?:合理推测|推测|Inference)\s*[：:]\s*(.+)$/iu,
  },
  {
    kind: "hypothesis",
    re: /^(?:纯假设|假设|Hypothesis)\s*[：:]\s*(.+)$/iu,
  },
];

/** UI label for a parsed attribution kind (i18n). */
export function getSourceAttributionKindLabel(kind: SourceAttributionKind): string {
  if (kind === "other") return "";
  return i18n.t(`sourceAttribution.${kind}`, { ns: "chat" });
}

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
        attribution: {
          kind: rule.kind,
          label: getSourceAttributionKindLabel(rule.kind),
          text: m[1].trim(),
        },
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
  if (SOURCES_BIBLIOGRAPHY_HEADING_RE.test(trimmed)) return "sources-bibliography";
  return null;
}

const SOURCES_MD_LINK_RE =
  /^(?:[-*]\s+)?(?:\[(\d+)\]\s+|\d+\.\s+)?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/u;

const SOURCES_MARKER_URL_RE =
  /^(?:[-*]\s+)?(?:\[(\d+)\]|(\d+)\.)\s+(.+?)\s+(<?https?:\/\/\S+>?)\s*$/u;

function unwrapUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseSourcesBibliographyRow(rawLine: string): BibliographyItem | null {
  const stripped = stripBlockquotePrefix(rawLine).trim();
  if (!stripped) return null;

  const mdLink = stripped.match(SOURCES_MD_LINK_RE);
  if (mdLink) {
    const url = unwrapUrl(mdLink[3] ?? "");
    const title = (mdLink[2] ?? "").trim();
    if (!url || !title) return null;
    return {
      id: mdLink[1] ? Number(mdLink[1]) : null,
      title,
      url,
    };
  }

  const marked = stripped.match(SOURCES_MARKER_URL_RE);
  if (!marked) return null;
  const url = unwrapUrl(marked[4] ?? "");
  const title = (marked[3] ?? "").trim();
  if (!url || !title) return null;
  const idRaw = marked[1] || marked[2];
  return {
    id: idRaw ? Number(idRaw) : null,
    title,
    url,
  };
}

function isLegendHeadingLine(line: string): boolean {
  return detectLegendKind(line) != null;
}

/**
 * Pull the trailing (or last) 数据来源标注 / 关键引用 / Sources bibliography
 * out of assistant markdown. Returns original content unchanged when no
 * parseable items are found.
 */
export function extractSourceAttribution(content: string): SourceAttributionExtract {
  const empty: SourceAttributionExtract = {
    body: content,
    items: [],
    keyCitations: [],
    bibliography: [],
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

  if (legendKind === "sources-bibliography") {
    const bibliography: BibliographyItem[] = [];
    let endIdx = headingIdx;
    for (let i = headingIdx + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const trimmed = stripBlockquotePrefix(line).trim();
      if (!trimmed) {
        if (bibliography.length > 0 && i + 1 < lines.length) {
          const next = stripBlockquotePrefix(lines[i + 1] ?? "").trim();
          if (!next) break;
        }
        endIdx = i;
        continue;
      }
      if (THEMATIC_BREAK_RE.test(trimmed)) break;
      if (/^#{1,6}\s+\S/u.test(trimmed) && !isLegendHeadingLine(line)) break;
      const row = parseSourcesBibliographyRow(line);
      if (!row) break;
      bibliography.push(row);
      endIdx = i;
    }
    if (bibliography.length === 0) return empty;
    const bodyLines = [...lines.slice(0, headingIdx), ...lines.slice(endIdx + 1)];
    const body = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
    return {
      body,
      items: [],
      keyCitations: [],
      bibliography,
      legendKind,
    };
  }

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
      bibliography: [],
      legendKind,
    };
  }

  return {
    body,
    items: rows.map((r) => r.attribution!).filter(Boolean),
    keyCitations: [],
    bibliography: [],
    legendKind,
  };
}

export function bibliographyToSearchReferences(rows: BibliographyItem[]): SearchReference[] {
  const out: SearchReference[] = [];
  rows.forEach((row, index) => {
    const url = String(row.url ?? "").trim();
    if (!url) return;
    out.push({
      id: row.id && Number.isFinite(row.id) ? row.id : index + 1,
      title: String(row.title ?? "").trim() || url,
      url,
      snippet: "",
      source: "web",
      domain: hostnameFromUrlOrDomain(url) || undefined,
    });
  });
  return out;
}

/** Prefer structured search refs; fall back to a stripped Sources bibliography. */
export function withBibliographyFallback(
  references: SearchReference[] | undefined,
  content: string,
): SearchReference[] {
  if ((references?.length ?? 0) > 0) return references ?? [];
  return bibliographyToSearchReferences(extractSourceAttribution(content).bibliography);
}

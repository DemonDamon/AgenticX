/** Marker the Studio backend appends when injecting quote context for the model. */
export const USER_QUOTE_MARKER = "[用户引用内容]";

/** Separator between multiple quote payloads in `quoted_content`. */
export const QUOTE_ITEM_SEP = "\n\n<<<agx-quote>>>\n\n";

/**
 * Inline quote chip placeholders for composer / history.
 * Must survive `innerText` (PUA \uE000/\uE001 are stripped by Chromium → bare "quote:0").
 */
export const COMPOSER_QUOTE_PH_PREFIX = "[[agx-quote:";
export const COMPOSER_QUOTE_PH_SUFFIX = "]]";

/** @deprecated Kept only to recognize older composer/history rows. */
export const COMPOSER_QUOTE_MARK_START = "\uE000";
/** @deprecated Kept only to recognize older composer/history rows. */
export const COMPOSER_QUOTE_MARK_END = "\uE001";

const COMPOSER_QUOTE_PH_RE = /\[\[agx-quote:([^\]]+)\]\]/g;
const LEGACY_PUA_PH_RE = /\uE000quote:([^\uE001]+)\uE001/g;
/** Bare form left when Chromium `innerText` strips PUA wrappers. */
const BARE_QUOTE_INDEX_RE = /\bquote:(\d+)\b/g;

export function composerQuotePlaceholder(id: string): string {
  return `${COMPOSER_QUOTE_PH_PREFIX}${id}${COMPOSER_QUOTE_PH_SUFFIX}`;
}

/** True when persisted/display content still carries inline quote chip markers. */
export function bodyHasInlineQuotePlaceholders(text: string): boolean {
  const s = String(text || "");
  return (
    s.includes(COMPOSER_QUOTE_PH_PREFIX) ||
    s.includes(COMPOSER_QUOTE_MARK_START) ||
    /\bquote:\d+\b/.test(s)
  );
}

/**
 * Normalize body for bubble render: upgrade legacy/broken placeholders to
 * `[[agx-quote:N]]` so chips resolve at the correct inline positions.
 */
export function normalizeInlineQuoteBodyForDisplay(
  body: string,
  quotedItems: string[]
): string {
  let raw = String(body || "");
  raw = raw.replace(LEGACY_PUA_PH_RE, (_m, id: string) => composerQuotePlaceholder(id));
  if (raw.includes(COMPOSER_QUOTE_PH_PREFIX)) return raw;
  if (quotedItems.length === 0) return raw;
  // Repair bare "quote:0" left after innerText stripped PUA wrappers.
  return raw.replace(BARE_QUOTE_INDEX_RE, (full, n: string) => {
    const idx = Number.parseInt(n, 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < quotedItems.length) {
      return composerQuotePlaceholder(String(idx));
    }
    return full;
  });
}

/** Map composer uuid placeholders → stable index placeholders for history/display. */
export function normalizeComposerQuotePlaceholdersToIndices(
  textWithPlaceholders: string,
  orderedQuoteIds: string[]
): string {
  let result = String(textWithPlaceholders || "");
  // Also upgrade any surviving legacy PUA forms before id remapping.
  result = result.replace(LEGACY_PUA_PH_RE, (_m, id: string) => composerQuotePlaceholder(id));
  orderedQuoteIds.forEach((id, idx) => {
    if (!id) return;
    result = result.split(composerQuotePlaceholder(id)).join(composerQuotePlaceholder(String(idx)));
    // Legacy PUA with this uuid (if extract somehow preserved it).
    result = result
      .split(`${COMPOSER_QUOTE_MARK_START}quote:${id}${COMPOSER_QUOTE_MARK_END}`)
      .join(composerQuotePlaceholder(String(idx)));
  });
  return result;
}

/** Resolve a placeholder id (usually index) to the quoted display string. */
export function resolveInlineQuoteDisplayText(
  placeholderId: string,
  quotedItems: string[]
): string {
  const idx = Number.parseInt(placeholderId, 10);
  if (Number.isFinite(idx) && idx >= 0 && idx < quotedItems.length) {
    return quotedItems[idx] ?? "";
  }
  return "";
}

/** Expand inline quote placeholders for clipboard plain text. */
export function expandInlineQuotePlaceholdersForCopy(
  body: string,
  quotedItems: string[]
): string {
  const raw = normalizeInlineQuoteBodyForDisplay(body, quotedItems);
  if (!raw.includes(COMPOSER_QUOTE_PH_PREFIX) && !raw.includes(COMPOSER_QUOTE_MARK_START)) {
    return String(body || "");
  }
  let out = "";
  let cursor = 0;
  while (cursor < raw.length) {
    const ph = matchComposerQuotePlaceholder(raw, cursor);
    if (ph) {
      const quoted = resolveInlineQuoteDisplayText(ph.id, quotedItems);
      out += quoted ? `「引用」${quoted}` : "";
      cursor += ph.len;
      continue;
    }
    out += raw[cursor];
    cursor += 1;
  }
  return out;
}

/** Strip quote placeholders from composer text before send / empty checks / @ autocomplete. */
export function stripComposerQuotePlaceholders(text: string): string {
  return String(text || "")
    .replace(COMPOSER_QUOTE_PH_RE, "")
    .replace(LEGACY_PUA_PH_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

/** Match next quote placeholder at `cursor`; returns id + consumed length. */
export function matchComposerQuotePlaceholder(
  value: string,
  cursor: number
): { id: string; len: number } | null {
  // Current format: [[agx-quote:ID]]
  if (value.startsWith(COMPOSER_QUOTE_PH_PREFIX, cursor)) {
    const idStart = cursor + COMPOSER_QUOTE_PH_PREFIX.length;
    const end = value.indexOf(COMPOSER_QUOTE_PH_SUFFIX, idStart);
    if (end < 0) return null;
    const id = value.slice(idStart, end);
    if (!id) return null;
    return { id, len: end + COMPOSER_QUOTE_PH_SUFFIX.length - cursor };
  }
  // Legacy PUA: \uE000quote:ID\uE001
  if (value[cursor] === COMPOSER_QUOTE_MARK_START) {
    if (!value.startsWith("quote:", cursor + 1)) return null;
    const end = value.indexOf(COMPOSER_QUOTE_MARK_END, cursor + 1);
    if (end < 0) return null;
    const id = value.slice(cursor + 1 + "quote:".length, end);
    if (!id) return null;
    return { id, len: end - cursor + 1 };
  }
  return null;
}

/** Index of the next inline quote placeholder at/after `from`, or -1. */
export function indexOfNextComposerQuotePlaceholder(value: string, from = 0): number {
  const s = String(value || "");
  const start = Math.max(0, from);
  const a = s.indexOf(COMPOSER_QUOTE_PH_PREFIX, start);
  const legacyNeedle = `${COMPOSER_QUOTE_MARK_START}quote:`;
  const b = s.indexOf(legacyNeedle, start);
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

export type SplitUserQuotedContent = {
  /** Visible user text without the quote dump. */
  body: string;
  /** Quoted payload after the marker (may include "Near: …" prefix). */
  quoted: string;
};

export type QuotePayloadItem = {
  label: string;
  body: string;
};

/**
 * Split persisted user content that inlined quote context for the LLM.
 * Returns null when the marker is absent.
 */
export function splitUserQuotedContent(content: string): SplitUserQuotedContent | null {
  const raw = String(content ?? "");
  const marker = USER_QUOTE_MARKER;
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;

  // Prefer the common "\n\n[用户引用内容]\n" layout; also tolerate single newlines.
  let bodyEnd = idx;
  while (bodyEnd > 0 && (raw[bodyEnd - 1] === "\n" || raw[bodyEnd - 1] === "\r")) {
    bodyEnd -= 1;
  }

  const quoted = raw.slice(idx + marker.length).replace(/^\r?\n/, "").trim();
  return {
    body: raw.slice(0, bodyEnd).trimEnd(),
    quoted,
  };
}

/** Serialize one or more quote items for API / history `quoted_content`. */
export function serializeQuotedContent(items: QuotePayloadItem[]): string {
  return items
    .map((item) => {
      const label = String(item.label || "").trim() || "AI";
      const body = String(item.body || "").trim();
      return body ? `${label}: ${body}` : label;
    })
    .filter(Boolean)
    .join(QUOTE_ITEM_SEP);
}

/** Split a stored `quoted_content` blob into per-chip display strings. */
export function parseQuotedContentItems(quotedContent: string | null | undefined): string[] {
  const raw = String(quotedContent || "").trim();
  if (!raw) return [];
  if (raw.includes("<<<agx-quote>>>")) {
    return raw
      .split(/\n*\s*<<<agx-quote>>>\s*\n*/g)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [raw];
}

/** Prefer explicit quotedContent; fall back to stripping an inlined marker block. */
export function resolveUserMessageQuoteDisplay(
  content: string,
  quotedContent?: string | null
): { body: string; quoted: string; quotedItems: string[] } {
  const explicit = String(quotedContent || "").trim();
  const split = splitUserQuotedContent(content);
  const quoted = split ? explicit || split.quoted : explicit;
  const quotedItems = parseQuotedContentItems(quoted);
  const rawBody = split ? split.body : String(content ?? "");
  return {
    body: normalizeInlineQuoteBodyForDisplay(rawBody, quotedItems),
    quoted,
    quotedItems,
  };
}

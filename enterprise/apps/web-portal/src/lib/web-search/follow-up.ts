/**
 * Referential follow-up detection + entity resolution for web-search query building.
 * Pure string/regex — no LLM rewrite.
 */

import { extractLastUserQuery, sanitizeWebSearchQuery } from "./tool-loop";

type ChatMessage = {
  role: string;
  content?: string | null;
};

/** 代词 / 指代 / 回指标记。u flag 必需（用了 \p{L}）。 */
const REFERENTIAL_MARKER =
  /(^|[^\p{L}])(他|她|它|他们|她们|这个|那个|这位|那位|这人|那人|此人|该人|上面(说)?的|刚才(说)?的|你刚(才)?说|你说的|前面(说)?的|这事|那件事)/u;

/** 自带实体的迹象：书名号 / 引号 / 连续 ASCII 词（品牌名、型号）。 */
const SELF_CONTAINED_ENTITY =
  /《[^》]{1,30}》|「[^」]{1,30}」|“[^”]{1,30}”|[A-Za-z][A-Za-z0-9.\-]{2,}/u;

// Match both provider `<think>` and portal-normalized `<think>` wrappers.
const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";
const REDACTED_OPEN = "<think>";
const REDACTED_CLOSE = "</think>";

function stripThinkBlocks(text: string): string {
  let out = text;
  const pairs: Array<[string, string]> = [
    [THINK_OPEN, THINK_CLOSE],
    [REDACTED_OPEN, REDACTED_CLOSE],
  ];
  for (const [open, close] of pairs) {
    const openLower = open.toLowerCase();
    const closeLower = close.toLowerCase();
    while (true) {
      const lower = out.toLowerCase();
      const start = lower.indexOf(openLower);
      if (start < 0) break;
      const end = lower.indexOf(closeLower, start + open.length);
      if (end < 0) {
        out = out.slice(0, start);
        break;
      }
      out = out.slice(0, start) + out.slice(end + close.length);
    }
  }
  return out.trim();
}

export function isReferentialFollowUp(query: string): boolean {
  const q = query.trim();
  if (!q || q.length > 40) return false;
  if (SELF_CONTAINED_ENTITY.test(q)) return false;
  return REFERENTIAL_MARKER.test(q);
}

/**
 * Prefer bold entity over quoted topic words — e.g. 「宗主」 appears before **蔡徐坤**.
 */
export function extractEntityFromHistory(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const raw = typeof msg.content === "string" ? msg.content : "";
    if (!raw.trim()) continue;

    const visible = stripThinkBlocks(raw);
    if (!visible) continue;

    const bold = visible.match(/\*\*([^*]{2,20})\*\*/);
    if (bold?.[1]) {
      const entity = bold[1].trim();
      if (entity.length >= 2 && entity.length <= 20) return entity;
    }

    const quoted =
      visible.match(/《([^》]{2,20})》/) ??
      visible.match(/「([^」]{2,20})」/) ??
      visible.match(/“([^”]{2,20})”/);
    if (quoted?.[1]) {
      const entity = quoted[1].trim();
      if (entity.length >= 2 && entity.length <= 20) return entity;
    }
  }
  return "";
}

export function resolveFollowUpQuery(
  messages: ChatMessage[],
): { query: string; entity: string } | null {
  const last = extractLastUserQuery(messages);
  if (!isReferentialFollowUp(last)) return null;

  const entity = extractEntityFromHistory(messages);
  if (!entity) return { query: "", entity: "" };

  return {
    query: sanitizeWebSearchQuery(`${entity} ${last}`),
    entity,
  };
}

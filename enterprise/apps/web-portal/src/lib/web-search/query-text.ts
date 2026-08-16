/** Shared, dependency-free text normalization for search and research routing. */

/** Keep search keywords short — full document dumps make providers challenge or return empty. */
export const MAX_WEB_SEARCH_QUERY_CHARS = 240;

const PORTAL_ATTACHMENT_AFTER_TEXT = /\n---\s*(?:附件|attachment)\s*[:：]/i;
const PORTAL_ATTACHMENT_AT_START = /^---\s*(?:附件|attachment)\s*[:：]/i;
const PORTAL_ATTACHMENT_NAME =
  /^---\s*(?:附件|attachment)\s*[:：]\s*(.+?)\s*---/i;

export function isPortalAttachmentOnlyTurn(raw: string): boolean {
  return PORTAL_ATTACHMENT_AT_START.test(raw.replace(/\r\n/g, "\n").trim());
}

export function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string" && row.text.trim()) {
      parts.push(row.text.trim());
    }
  }
  return parts.join("\n").trim();
}

/**
 * Strip portal-injected attachment bodies (`--- 附件: name ---…`) so web search
 * uses the user's short question rather than the whole parsed file.
 */
export function sanitizeWebSearchQuery(
  raw: string,
  maxChars = MAX_WEB_SEARCH_QUERY_CHARS,
): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const attachIdx = text.search(PORTAL_ATTACHMENT_AFTER_TEXT);
  if (attachIdx >= 0) {
    text = text.slice(0, attachIdx).trim();
  } else if (PORTAL_ATTACHMENT_AT_START.test(text)) {
    const nameMatch = text.match(PORTAL_ATTACHMENT_NAME);
    text = nameMatch?.[1]?.trim() || "";
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd();
}

/**
 * Research prompts may put output constraints at the end. Keep both boundaries
 * when bounding them; ordinary provider queries continue using prefix truncation.
 */
export function sanitizeResearchRequest(raw: string, maxChars: number): string {
  const text = sanitizeWebSearchQuery(raw, Number.MAX_SAFE_INTEGER);
  if (text.length <= maxChars) return text;
  const separator = " … ";
  const usable = Math.max(2, maxChars - separator.length);
  const head = Math.ceil(usable / 2);
  const tail = Math.floor(usable / 2);
  return `${text.slice(0, head).trimEnd()}${separator}${text.slice(-tail).trimStart()}`;
}

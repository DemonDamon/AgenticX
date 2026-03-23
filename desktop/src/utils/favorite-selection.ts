/** Selection wholly inside `root` (e.g. message bubble body), trimmed. */
export function getContainedSelectionText(root: HTMLElement | null): string | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const a = sel.anchorNode;
  const f = sel.focusNode;
  if (!a || !f) return null;
  if (!root.contains(a) || !root.contains(f)) return null;
  const t = sel.toString().replace(/\u00a0/g, " ").trim();
  return t.length > 0 ? t : null;
}

function fnv1a32Hex(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Stable id for favorites.json: full message uses real id; excerpt uses suffix so
 * the same chat message can have multiple non-duplicate favorites.
 */
export function favoriteStorageMessageId(messageId: string, contentToSave: string, fullRawContent: string): string {
  const full = fullRawContent.trim();
  const part = contentToSave.trim();
  if (!part) return messageId;
  if (full.length > 0 && part === full) return messageId;
  return `${messageId}::excerpt::${fnv1a32Hex(part)}`;
}

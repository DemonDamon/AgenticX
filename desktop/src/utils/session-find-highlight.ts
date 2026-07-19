/**
 * In-session find highlighting via the CSS Custom Highlight API.
 * Avoids mutating React-managed DOM (which previously crashed ImBubble).
 */

export const SESSION_FIND_HIGHLIGHT = "agx-session-find";
export const SESSION_FIND_ACTIVE_HIGHLIGHT = "agx-session-find-active";

export type SessionFindMatch = {
  range: Range;
  top: number;
};

function cssHighlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

function isSkippableTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest("script, style, textarea, input, [contenteditable='true']")) return true;
  // Skip code tokens that already use <mark> from tool cards to avoid double paint noise;
  // still include their text for match counting via the walker — only skip if aria-hidden.
  if (parent.closest("[aria-hidden='true']")) return true;
  return false;
}

/** Collect case-insensitive substring matches as Ranges under *root*. */
export function collectSessionFindMatches(root: HTMLElement, query: string): SessionFindMatch[] {
  const q = String(query || "").trim();
  if (!q || !root) return [];
  const needle = q.toLocaleLowerCase();
  const needleLen = needle.length;
  const matches: SessionFindMatch[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (!isSkippableTextNode(textNode)) {
      const value = textNode.nodeValue ?? "";
      if (value) {
        const lower = value.toLocaleLowerCase();
        let from = 0;
        while (from <= lower.length - needleLen) {
          const idx = lower.indexOf(needle, from);
          if (idx < 0) break;
          try {
            const range = document.createRange();
            range.setStart(textNode, idx);
            range.setEnd(textNode, idx + needleLen);
            const rect = range.getBoundingClientRect();
            matches.push({ range, top: rect.top + (typeof window !== "undefined" ? window.scrollY : 0) });
          } catch {
            // Detached / invalid range — skip
          }
          from = idx + needleLen;
        }
      }
    }
    node = walker.nextNode();
  }
  return matches;
}

export function clearSessionFindHighlights(): void {
  if (!cssHighlightsSupported()) return;
  try {
    CSS.highlights.delete(SESSION_FIND_HIGHLIGHT);
    CSS.highlights.delete(SESSION_FIND_ACTIVE_HIGHLIGHT);
  } catch {
    /* ignore */
  }
}

/**
 * Apply find highlights and scroll the active match into view.
 * Returns total match count (0 if none / unsupported).
 */
export function applySessionFindHighlights(
  root: HTMLElement | null,
  query: string,
  activeIndex: number
): { count: number; activeIndex: number } {
  clearSessionFindHighlights();
  if (!root) return { count: 0, activeIndex: 0 };
  const matches = collectSessionFindMatches(root, query);
  if (matches.length === 0) return { count: 0, activeIndex: 0 };

  const safeIndex = ((activeIndex % matches.length) + matches.length) % matches.length;
  if (!cssHighlightsSupported()) {
    // Fallback: scroll to the active range's common ancestor without painting.
    try {
      const el =
        matches[safeIndex]?.range.commonAncestorContainer instanceof Element
          ? matches[safeIndex].range.commonAncestorContainer
          : matches[safeIndex]?.range.commonAncestorContainer.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } catch {
      /* ignore */
    }
    return { count: matches.length, activeIndex: safeIndex };
  }

  try {
    const all = new Highlight(...matches.map((m) => m.range));
    CSS.highlights.set(SESSION_FIND_HIGHLIGHT, all);
    CSS.highlights.set(SESSION_FIND_ACTIVE_HIGHLIGHT, new Highlight(matches[safeIndex].range));
  } catch {
    /* ignore paint failures */
  }

  try {
    const active = matches[safeIndex]?.range;
    if (active) {
      const el =
        active.commonAncestorContainer instanceof Element
          ? active.commonAncestorContainer
          : active.commonAncestorContainer.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  } catch {
    /* ignore */
  }

  return { count: matches.length, activeIndex: safeIndex };
}

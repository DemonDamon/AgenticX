/**
 * Composer keystroke policy: keep contenteditable as source of truth and only
 * commit React state when the UI actually needs it (empty ↔ non-empty, @mention).
 */

export const AT_MENTION_SEARCH_DEBOUNCE_MS = 100;

const TRAILING_AT_RE = /(?:^|\s)@([^\s@]*)$/;

export function isComposerNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/** Cheap emptiness check from live contenteditable textContent (IME path; no cloneNode). */
export function domTextLooksNonEmpty(textContent: string | null | undefined): boolean {
  return Boolean((textContent || "").replace(/\u00a0/g, " ").trim());
}

export function matchTrailingAtMention(value: string): string | null {
  const match = value.match(TRAILING_AT_RE);
  if (!match) return null;
  return match[1] ?? "";
}

export function shouldCommitComposerHasText(prevHasText: boolean, nextValue: string): boolean {
  return prevHasText !== isComposerNonEmpty(nextValue);
}

export type ComposerAtMentionState = {
  open: boolean;
  query: string;
  shouldSearch: boolean;
};

export function nextComposerAtMentionState(value: string): ComposerAtMentionState {
  const query = matchTrailingAtMention(value);
  if (query === null) {
    return { open: false, query: "", shouldSearch: false };
  }
  return { open: true, query, shouldSearch: true };
}

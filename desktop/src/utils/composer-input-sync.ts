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

export function composerTextBeforeCaret(value: string, caretOffset = value.length): string {
  const offset = Math.max(0, Math.min(value.length, caretOffset));
  return value.slice(0, offset);
}

/** Replace the @ token ending `textBeforeCaret`; keep `textAfterCaret` intact. */
export function replaceAtMentionAtCaret(
  textBeforeCaret: string,
  textAfterCaret: string,
  mention: string
): string {
  if (matchTrailingAtMention(textBeforeCaret) === null) {
    const sep = !textBeforeCaret || /\s$/.test(textBeforeCaret) ? "" : " ";
    return `${textBeforeCaret}${sep}${mention}${textAfterCaret}`;
  }
  const prefix = textBeforeCaret.replace(TRAILING_AT_RE, (text) =>
    `${text.startsWith(" ") ? " " : ""}${mention}`
  );
  return `${prefix}${textAfterCaret}`;
}

export function shouldCommitComposerHasText(prevHasText: boolean, nextValue: string): boolean {
  return prevHasText !== isComposerNonEmpty(nextValue);
}

export type ComposerAtMentionState = {
  open: boolean;
  query: string;
  shouldSearch: boolean;
};

export function nextComposerAtMentionState(
  value: string,
  caretOffset = value.length
): ComposerAtMentionState {
  const query = matchTrailingAtMention(composerTextBeforeCaret(value, caretOffset));
  if (query === null) {
    return { open: false, query: "", shouldSearch: false };
  }
  return { open: true, query, shouldSearch: true };
}

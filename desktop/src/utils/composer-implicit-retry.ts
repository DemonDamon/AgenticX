export type ComposerRetryRow = {
  role?: string;
  content?: string;
};

/**
 * Composer send is always a new user turn.
 * Matching an earlier user bubble must not truncate that turn or hide its
 * interrupted partial. Message-row 重试 owns truncation.
 */
export function findComposerImplicitRetryUserIndex(
  _messages: readonly ComposerRetryRow[],
  _text: string,
): number {
  return -1;
}

/** Automation task queries longer than this collapse to a short preview. */
export const LONG_USER_QUERY_CHAR_LIMIT = 180;

/** Non-empty line count that also counts as a long query, even under the char cap. */
export const LONG_USER_QUERY_LINE_LIMIT = 6;

/** True when a scheduled-task query should start collapsed. */
export function isLongUserQuery(text: string): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.length > LONG_USER_QUERY_CHAR_LIMIT) return true;
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.length >= LONG_USER_QUERY_LINE_LIMIT;
}

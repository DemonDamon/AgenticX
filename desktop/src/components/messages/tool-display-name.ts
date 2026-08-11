/** Human-readable tool names for group activity / tool chips. */

/** mcp__metaso-search__metaso_search → 「metaso-search · metaso_search」 */
export function formatToolDisplayName(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name) return "工具";
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (m) return `${m[1]} · ${m[2]}`;
  return name;
}

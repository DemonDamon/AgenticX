/** 与 agenticx/studio/session_manager.py _PLACEHOLDER_SESSION_TITLE_CF + 前缀规则对齐 */
const PLACEHOLDER_SESSION_TITLES_CF = new Set(
  [
    "微信会话",
    "微信对话",
    "微信聊天",
    "飞书会话",
    "飞书对话",
    "新对话",
    "新会话",
    "new chat",
    "new conversation",
    "欢迎使用 agenticx",
  ].map((s) => s.toLowerCase()),
);

export function sessionTitleNeedsAutoFill(name: string | null | undefined): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return true;
  const key = raw.toLowerCase();
  if (PLACEHOLDER_SESSION_TITLES_CF.has(key)) return true;
  if (key.startsWith("新会话") || key.startsWith("新对话")) return true;
  if (key.startsWith("new session") || key.startsWith("new chat")) return true;
  return false;
}

/** 与 session_manager._build_auto_title 一致：空白压平后取前 48 字 */
export function buildAutoTitleFromFirstUserMessage(message: string): string {
  const compact = String(message ?? "")
    .trim()
    .split(/\s+/)
    .join(" ");
  if (!compact) return "";
  return compact.length > 48 ? compact.slice(0, 48).trimEnd() : compact;
}

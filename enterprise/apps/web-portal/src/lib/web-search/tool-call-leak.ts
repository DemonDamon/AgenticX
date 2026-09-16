/**
 * MiniMax-class models often emit vendor tool XML (`minimax:tool_call` / `<invoke>`)
 * as assistant content instead of structured tool_calls. Search-first already
 * fetched hits — the markup is leakage, not an executable call.
 */

export function containsToolCallMarkup(raw: string): boolean {
  if (!raw) return false;
  return /<\s*(?:minimax:)?tool_call\b/i.test(raw) || /<\s*invoke\s+name\s*=/i.test(raw);
}

export function stripLeakedToolCallMarkup(raw: string): string {
  if (!raw) return raw;
  let text = raw
    .replace(/<\s*minimax:tool_call\b[^>]*>[\s\S]*?<\/\s*minimax:tool_call\s*>/gi, "")
    .replace(/<\s*tool_call\b[^>]*>[\s\S]*?<\/\s*tool_call\s*>/gi, "")
    .replace(/<\s*invoke\b[^>]*>[\s\S]*?<\/\s*invoke\s*>/gi, "");
  text = text
    .replace(/<\s*minimax:tool_call\b[\s\S]*$/gi, "")
    .replace(/<\s*tool_call\b[\s\S]*$/gi, "")
    .replace(/<\s*invoke\b[\s\S]*$/gi, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

function visibleProse(raw: string): string {
  let text = raw;
  const open = THINK_OPEN.toLowerCase();
  const close = THINK_CLOSE.toLowerCase();
  while (true) {
    const lower = text.toLowerCase();
    const start = lower.indexOf(open);
    if (start < 0) break;
    const end = lower.indexOf(close, start + THINK_OPEN.length);
    if (end < 0) {
      text = text.slice(0, start);
      break;
    }
    text = text.slice(0, start) + text.slice(end + THINK_CLOSE.length);
  }
  return text.replace(/\s+/g, "").trim();
}

const SEARCH_PREAMBLE =
  /^(我来帮您搜索|我来搜索|让我搜索|让我检索|我先搜索|正在搜索|正在检索|稍等|请稍)/;

/** True when markup is present and the leftover prose is only a "let me search" stub. */
export function isMostlyToolCallLeak(raw: string): boolean {
  if (!containsToolCallMarkup(raw)) return false;
  const visible = visibleProse(stripLeakedToolCallMarkup(raw));
  if (!visible) return true;
  if (visible.length < 40 && SEARCH_PREAMBLE.test(visible)) return true;
  return visible.length < 16;
}

export function isMinimaxModel(modelName?: string): boolean {
  return /minimax/i.test(modelName ?? "");
}

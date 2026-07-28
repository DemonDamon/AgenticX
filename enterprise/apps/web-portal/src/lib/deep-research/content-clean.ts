/** Strip model think / reasoning blocks from artifact markdown before persist or export. */

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

export function stripThinkBlocks(raw: string): string {
  if (!raw) return raw;
  let text = raw.replaceAll(THINK_OPEN, "<think>").replaceAll(THINK_CLOSE, "</think>");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Unclosed think: drop trailing reasoning so report body stays clean.
  const openIdx = text.toLowerCase().indexOf("<think>");
  if (openIdx >= 0) {
    text = text.slice(0, openIdx);
  }
  return text.replace(/^\s*\n+/, "").trim();
}

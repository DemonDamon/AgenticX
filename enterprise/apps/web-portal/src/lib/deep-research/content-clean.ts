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
  // A model can emit an unmatched closing tag in a later streaming chunk.
  // Never leak that transport residue into Markdown / HTML deliverables.
  text = text.replace(/<\/think>/gi, "");
  return text.replace(/^\s*\n+/, "").trim();
}

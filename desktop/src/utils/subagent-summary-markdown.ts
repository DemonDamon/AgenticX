/** Normalize legacy / wrapped sub-agent summaries for Markdown rendering in the card UI. */
export function normalizeSubAgentSummaryMarkdown(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return text;

  // [任务名] 已完成。 → **任务名** 已完成。
  text = text.replace(
    /^\[([^\]\n]+)\]\s*(已完成|已暂停|已取消|执行失败)/u,
    "**$1** $2",
  );

  // Remove redundant inline labels; the card section is already titled「最终摘要」.
  text = text.replace(/^(?:结果摘要|阶段性摘要)\s*[:：]\s*/gm, "");

  // ATX headings must start a line — break when embedded after prose on the same line.
  text = text.replace(/([^\n#])\s+(#{1,6}\s+)/g, "$1\n\n$2");

  // Structured footer is rendered in the dedicated「产出文件」block.
  const footerIdx = text.lastIndexOf("产出文件:");
  if (footerIdx >= 0) {
    text = text.slice(0, footerIdx).trimEnd();
  }

  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

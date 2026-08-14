/** Parse provider reasoning fields / inline think blocks for transient workbench display. */

export const MAX_MODEL_PROGRESS_CHARS = 6_000;

export type ModelProgressSnapshot = {
  text: string;
  kind: "reasoning" | "draft";
};

function boundedTail(raw: string): string {
  const text = raw.trim();
  if (text.length <= MAX_MODEL_PROGRESS_CHARS) return text;
  return `…${text.slice(-(MAX_MODEL_PROGRESS_CHARS - 1))}`;
}

/** Split visible output from any number of inline `<think>` blocks. */
export function splitInlineModelProgress(raw: string): {
  reasoning: string;
  output: string;
} {
  const source = raw ?? "";
  const reasoning: string[] = [];
  const output: string[] = [];
  const tag = /<\/?think>/gi;
  let cursor = 0;
  let insideThink = false;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(source)) !== null) {
    const chunk = source.slice(cursor, match.index);
    (insideThink ? reasoning : output).push(chunk);
    insideThink = !match[0].startsWith("</");
    cursor = match.index + match[0].length;
  }

  let tail = source.slice(cursor);
  // Do not flash a tag fragment when `<think>` is split across SSE chunks.
  const partialTag = tail.match(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i);
  if (partialTag?.index !== undefined) {
    tail = tail.slice(0, partialTag.index);
  }
  (insideThink ? reasoning : output).push(tail);

  return {
    reasoning: reasoning.join("").replace(/<\/?think>/gi, "").trim(),
    output: output.join("").replace(/<\/?think>/gi, "").trim(),
  };
}

export function modelProgressSnapshot(
  content: string,
  splitReasoning = "",
): ModelProgressSnapshot | null {
  const inline = splitInlineModelProgress(content);
  const reasoning = [splitReasoning, inline.reasoning]
    .map((part) => part.replace(/<\/?think>/gi, "").trim())
    .filter(Boolean)
    .join("\n");
  if (reasoning) {
    return { text: boundedTail(reasoning), kind: "reasoning" };
  }
  if (inline.output) {
    return { text: boundedTail(inline.output), kind: "draft" };
  }
  return null;
}

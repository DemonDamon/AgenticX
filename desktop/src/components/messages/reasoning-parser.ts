export type ReasoningParseResult = {
  reasoning: string;
  response: string;
  hasReasoningTag: boolean;
};

export function parseReasoningContent(content: string): ReasoningParseResult {
  const text = String(content ?? "");
  const openTag = "<think>";
  const closeTag = "</think>";
  const lower = text.toLowerCase();
  const openTagLower = openTag.toLowerCase();
  const closeTagLower = closeTag.toLowerCase();

  const reasoningParts: string[] = [];
  const responseParts: string[] = [];
  let cursor = 0;
  let hasReasoningTag = false;

  while (cursor < text.length) {
    const openIdx = lower.indexOf(openTagLower, cursor);
    if (openIdx < 0) {
      responseParts.push(text.slice(cursor));
      break;
    }
    hasReasoningTag = true;
    responseParts.push(text.slice(cursor, openIdx));
    const reasoningStart = openIdx + openTag.length;
    const closeIdx = lower.indexOf(closeTagLower, reasoningStart);
    if (closeIdx < 0) {
      // Stream-in-progress case: <think> arrived but </think> not yet.
      reasoningParts.push(text.slice(reasoningStart));
      cursor = text.length;
      break;
    }
    reasoningParts.push(text.slice(reasoningStart, closeIdx));
    cursor = closeIdx + closeTag.length;
  }

  return {
    reasoning: reasoningParts.join("").trim(),
    response: responseParts.join("").trim(),
    hasReasoningTag,
  };
}


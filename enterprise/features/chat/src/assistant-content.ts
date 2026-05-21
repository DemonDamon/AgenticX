import type { ChatMessage } from "@agenticx/core-api";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";
const REDACTED_OPEN = "<think>";
const REDACTED_CLOSE = "</think>";

export type ParsedAssistantContent = {
  displayContent: string;
  reasoningContent: string;
  thinkingStarted: boolean;
  thinkingInProgress: boolean;
};

export function normalizeThinkTags(raw: string): string {
  if (!raw) return raw;
  return raw.replaceAll(THINK_OPEN, REDACTED_OPEN).replaceAll(THINK_CLOSE, REDACTED_CLOSE);
}

/** MiniMax 等模型常在推理段写好代码，可见正文却在 ``` 处提前 stop；从推理段补全未闭合代码块。 */
export function recoverIncompleteCodeFences(displayContent: string, reasoningContent: string): string {
  const trimmed = displayContent.replace(/\s+$/, "");
  if (!/```[^\n`]*\n?$/.test(trimmed)) return displayContent;

  const langMatch = trimmed.match(/```([^\n`]*)?\n?$/);
  const lang = langMatch?.[1] ?? "";
  const escaped = lang.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fenceRe = new RegExp("```" + (escaped || "[\\w+-]*") + "\\n[\\s\\S]*?```");
  const fromReasoning = reasoningContent.match(fenceRe);
  if (!fromReasoning) return displayContent;

  const inner = fromReasoning[0].replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
  const needsLeadingNewline = !trimmed.endsWith("\n");
  return `${trimmed}${needsLeadingNewline ? "\n" : ""}${inner}\n\`\`\``;
}

export function parseAssistantContent(message: ChatMessage): ParsedAssistantContent {
  const fallbackReasoning = (message.reasoning ?? "").trim();
  const raw = normalizeThinkTags(message.content ?? "");
  const lower = raw.toLowerCase();
  const openIdx = lower.indexOf(REDACTED_OPEN);

  if (openIdx < 0) {
    const displayContent = recoverIncompleteCodeFences(raw, fallbackReasoning);
    return {
      displayContent,
      reasoningContent: fallbackReasoning,
      thinkingStarted: fallbackReasoning.length > 0,
      thinkingInProgress: false,
    };
  }

  const before = raw.slice(0, openIdx);
  const reasoningStart = openIdx + REDACTED_OPEN.length;
  const closeIdx = lower.indexOf(REDACTED_CLOSE, reasoningStart);

  if (closeIdx < 0) {
    const reasoningContent = raw.slice(reasoningStart);
    return {
      displayContent: recoverIncompleteCodeFences(before, reasoningContent),
      reasoningContent,
      thinkingStarted: true,
      thinkingInProgress: true,
    };
  }

  const reasoningContent = raw.slice(reasoningStart, closeIdx);
  const displayContent = recoverIncompleteCodeFences(
    `${before}${raw.slice(closeIdx + REDACTED_CLOSE.length)}`,
    reasoningContent
  );

  return {
    displayContent,
    reasoningContent,
    thinkingStarted: true,
    thinkingInProgress: false,
  };
}

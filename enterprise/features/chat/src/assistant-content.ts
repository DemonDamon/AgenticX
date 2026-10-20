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

/** 非流式、可见正文为空时展示；推理原文仍留在 reasoning。 */
export const STREAM_EMPTY_RESPONSE_ERROR =
  "尚未生成最终答复，已保留已有内容。可继续生成或重新生成重试。";

/** Convert rendered-style Markdown into text suitable for copying to a human reader. */
export function markdownToPlainText(raw: string): string {
  let text = (raw ?? "").replace(/\r\n?/g, "\n");
  const codeBlocks: string[] = [];

  text = text.replace(/```[^\n]*\n([\s\S]*?)\n?```/g, (_match, body: string) => {
    const marker = `\u0000code-${codeBlocks.length}\u0000`;
    codeBlocks.push(body.replace(/\n$/, ""));
    return marker;
  });

  text = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[ \t]{0,3}\[[^\]\n]+\]:\s*\S+(?:\s+["'(].*?)?\s*$/gm, "")
    .replace(/\[(?:\d{1,3}|N)\]/gi, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/!\[([^\]\n]*)\]\((?:\\.|[^)])*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\((?:\\.|[^)])*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\s*\[[^\]\n]*\]/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!|>~-])/g, "$1");

  text = text
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed)) return [];
      if (!trimmed.includes("|")) return [line];
      const cells = trimmed
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      return [cells.join("\t")];
    })
    .join("\n")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/^[ \t]*[-+*][ \t]+/gm, "• ")
    .replace(/^[ \t]*(\d+)[.)][ \t]+/gm, "$1. ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");

  for (const [index, body] of codeBlocks.entries()) {
    text = text.replace(`\u0000code-${index}\u0000`, body);
  }

  return text.trim();
}

/** Return the visible, Markdown-free text for a message copy action. */
export function toCopyableMessageText(message: ChatMessage): string {
  const visibleContent = message.role === "assistant"
    ? parseAssistantContent(message, false).displayContent
    : message.content ?? "";
  return markdownToPlainText(visibleContent);
}

export function normalizeThinkTags(raw: string): string {
  if (!raw) return raw;
  return raw.replaceAll(THINK_OPEN, REDACTED_OPEN).replaceAll(THINK_CLOSE, REDACTED_CLOSE);
}

/** MiniMax 等模型在附件问答里会输出 `<citations>…</citations>` 占位，前台不应原样展示。 */
export function stripModelCitationTags(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(/<\s*citations?\s*>/gi, "")
    .replace(/<\s*\/\s*citations?\s*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * MiniMax-class models often emit vendor tool XML as visible content
 * (`minimax:tool_call` / `<invoke>`) instead of structured tool_calls.
 * Historical bubbles and copy actions must not show that markup.
 */
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

/** 模型占位 `[N]`（非数字引用）与附件说明行前缀，避免像渲染失败。 */
export function stripPlaceholderCitationMarkers(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(/\[N\]\s*/gi, "")
    .replace(/^[ \t]*[-•·]\s*文档内容基于提供的附件[：:]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function finalizeAssistantDisplayContent(raw: string): string {
  return stripPlaceholderCitationMarkers(stripModelCitationTags(stripLeakedToolCallMarkup(raw)));
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

/** Preview / artifact helpers: strip think blocks from raw assistant-shaped text. */
export function displayContentFromRawAssistantText(raw: string): string {
  return parseAssistantContent({
    id: "_preview",
    session_id: "_",
    tenant_id: "_",
    user_id: "_",
    role: "assistant",
    content: raw ?? "",
    created_at: new Date(0).toISOString(),
  }, true).displayContent;
}

/** Keep saved stream bytes, but never tell a resumed model that reasoning is an answer. */
export function prepareAssistantContinuation(raw: string): { retainedContent: string; requestContent: string } {
  const source = raw ?? "";
  const normalized = normalizeThinkTags(source);
  const lower = normalized.toLowerCase();
  const openIdx = lower.indexOf(REDACTED_OPEN);
  if (openIdx < 0) {
    return { retainedContent: source, requestContent: normalized };
  }
  const reasoningStart = openIdx + REDACTED_OPEN.length;
  const closeIdx = lower.indexOf(REDACTED_CLOSE, reasoningStart);
  if (closeIdx < 0) {
    return {
      // A stopped open reasoning block must not swallow the next turn's answer.
      retainedContent: `${source}${THINK_CLOSE}`,
      requestContent: normalized.slice(0, openIdx),
    };
  }
  return {
    retainedContent: source,
    requestContent: `${normalized.slice(0, openIdx)}${normalized.slice(closeIdx + REDACTED_CLOSE.length)}`,
  };
}

export function parseAssistantContent(message: ChatMessage, streaming = false): ParsedAssistantContent {
  const fallbackReasoning = (message.reasoning ?? "").trim();
  const raw = normalizeThinkTags(message.content ?? "");
  const lower = raw.toLowerCase();
  const openIdx = lower.indexOf(REDACTED_OPEN);

  if (openIdx < 0) {
    let displayContent = finalizeAssistantDisplayContent(recoverIncompleteCodeFences(raw, fallbackReasoning));
    if (!streaming && !displayContent.trim() && !message.deep_research && message.interruption) {
      displayContent = STREAM_EMPTY_RESPONSE_ERROR;
    }
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
  const unclosed = closeIdx < 0;
  const reasoningContent = unclosed ? raw.slice(reasoningStart) : raw.slice(reasoningStart, closeIdx);
  let displayContent = finalizeAssistantDisplayContent(
    recoverIncompleteCodeFences(
      unclosed ? before : `${before}${raw.slice(closeIdx + REDACTED_CLOSE.length)}`,
      reasoningContent,
    ),
  );
  if (
    !streaming &&
    !displayContent.trim() &&
    !message.deep_research &&
    (message.interruption || unclosed)
  ) {
    displayContent = STREAM_EMPTY_RESPONSE_ERROR;
  }

  return {
    displayContent,
    reasoningContent,
    thinkingStarted: true,
    thinkingInProgress: unclosed && streaming,
  };
}

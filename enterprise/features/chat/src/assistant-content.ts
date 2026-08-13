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
    ? parseAssistantContent(message).displayContent
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
  return stripPlaceholderCitationMarkers(stripModelCitationTags(raw));
}

type ThinkSplit = {
  display: string;
  reasoning: string;
  started: boolean;
  inProgress: boolean;
};

type ThinkMarker = {
  index: number;
  kind: "open" | "close";
  length: number;
};

function repeatedCharLength(raw: string, index: number, char: string): number {
  let end = index;
  while (raw[end] === char) end += 1;
  return end - index;
}

function isEscaped(raw: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && raw[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isFencePosition(raw: string, lineStart: number, index: number): boolean {
  if (index - lineStart > 3) return false;
  for (let cursor = lineStart; cursor < index; cursor += 1) {
    if (raw[cursor] !== " ") return false;
  }
  return true;
}

/**
 * Locate provider reasoning markers without treating Markdown code samples as
 * protocol. This stays deliberately lexical: a single pass tracks CommonMark
 * backtick spans and fenced code blocks, so literal `<think>` examples remain
 * visible without needing a catalog of surrounding words or document types.
 */
function collectThinkMarkers(raw: string): ThinkMarker[] {
  const markers: ThinkMarker[] = [];
  let cursor = 0;
  let lineStart = 0;
  let inlineBacktickLength = 0;
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  while (cursor < raw.length) {
    const char = raw[cursor];
    if (char === "\n") {
      lineStart = cursor + 1;
      cursor += 1;
      continue;
    }

    if (fenceChar) {
      if (
        char === fenceChar &&
        isFencePosition(raw, lineStart, cursor) &&
        !isEscaped(raw, cursor)
      ) {
        const runLength = repeatedCharLength(raw, cursor, fenceChar);
        if (runLength >= fenceLength) {
          fenceChar = null;
          fenceLength = 0;
        }
        cursor += runLength;
        continue;
      }
      cursor += 1;
      continue;
    }

    if (inlineBacktickLength > 0) {
      if (char === "`" && !isEscaped(raw, cursor)) {
        const runLength = repeatedCharLength(raw, cursor, "`");
        if (runLength === inlineBacktickLength) inlineBacktickLength = 0;
        cursor += runLength;
        continue;
      }
      cursor += 1;
      continue;
    }

    if ((char === "`" || char === "~") && !isEscaped(raw, cursor)) {
      const runLength = repeatedCharLength(raw, cursor, char);
      if (runLength >= 3 && isFencePosition(raw, lineStart, cursor)) {
        fenceChar = char;
        fenceLength = runLength;
        cursor += runLength;
        continue;
      }
      if (char === "`") {
        inlineBacktickLength = runLength;
        cursor += runLength;
        continue;
      }
    }

    if (!isEscaped(raw, cursor)) {
      const candidate = raw.slice(cursor, cursor + REDACTED_CLOSE.length).toLowerCase();
      if (candidate.startsWith(REDACTED_OPEN)) {
        markers.push({ index: cursor, kind: "open", length: REDACTED_OPEN.length });
        cursor += REDACTED_OPEN.length;
        continue;
      }
      if (candidate === REDACTED_CLOSE) {
        markers.push({ index: cursor, kind: "close", length: REDACTED_CLOSE.length });
        cursor += REDACTED_CLOSE.length;
        continue;
      }
    }

    cursor += 1;
  }

  return markers;
}

function joinReasoningParts(parts: string[]): string {
  let output = "";
  for (const part of parts) {
    if (!part) continue;
    if (
      output &&
      !/\s$/.test(output) &&
      !/^\s/.test(part)
    ) {
      output += "\n";
    }
    output += part;
  }
  return output;
}

/**
 * Split every reasoning block, including malformed provider streams that repeat
 * closing tags without repeating an opening tag. Text immediately before an
 * orphan close belongs to reasoning; only text after the final close is visible.
 */
function splitThinkContent(raw: string): ThinkSplit {
  const markers = collectThinkMarkers(raw);
  const displayParts: string[] = [];
  const reasoningParts: string[] = [];
  let cursor = 0;
  let markerCursor = 0;
  let started = false;
  let inProgress = false;

  while (cursor < raw.length && markerCursor < markers.length) {
    const marker = markers[markerCursor];
    if (!marker) break;

    if (marker.kind === "open") {
      displayParts.push(raw.slice(cursor, marker.index));
      started = true;
      const reasoningStart = marker.index + marker.length;
      let matchingCloseCursor = markerCursor + 1;
      while (
        matchingCloseCursor < markers.length &&
        markers[matchingCloseCursor]?.kind !== "close"
      ) {
        matchingCloseCursor += 1;
      }
      const matchingClose = markers[matchingCloseCursor];
      if (!matchingClose) {
        reasoningParts.push(raw.slice(reasoningStart));
        inProgress = true;
        cursor = raw.length;
        break;
      }
      reasoningParts.push(raw.slice(reasoningStart, matchingClose.index));
      cursor = matchingClose.index + matchingClose.length;
      markerCursor = matchingCloseCursor + 1;
      continue;
    }

    // A close tag without a matching open is still an explicit reasoning
    // boundary. Treat the preceding fragment as reasoning instead of leaking
    // both the fragment and raw XML marker into the answer body.
    reasoningParts.push(raw.slice(cursor, marker.index));
    started = true;
    cursor = marker.index + marker.length;
    markerCursor += 1;
  }

  if (cursor < raw.length) displayParts.push(raw.slice(cursor));

  return {
    display: displayParts.join(""),
    reasoning: joinReasoningParts(reasoningParts),
    started,
    inProgress,
  };
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
  }).displayContent;
}

export function parseAssistantContent(message: ChatMessage): ParsedAssistantContent {
  const fallbackReasoning = (message.reasoning ?? "").trim();
  const raw = normalizeThinkTags(message.content ?? "");
  const lower = raw.toLowerCase();
  const openIdx = lower.indexOf(REDACTED_OPEN);
  const closeIdx = lower.indexOf(REDACTED_CLOSE);

  if (openIdx < 0 && closeIdx < 0) {
    const displayContent = finalizeAssistantDisplayContent(recoverIncompleteCodeFences(raw, fallbackReasoning));
    return {
      displayContent,
      reasoningContent: fallbackReasoning,
      thinkingStarted: fallbackReasoning.length > 0,
      thinkingInProgress: false,
    };
  }

  const split = splitThinkContent(raw);
  const reasoningContent = split.reasoning || fallbackReasoning;
  const displayContent = finalizeAssistantDisplayContent(
    recoverIncompleteCodeFences(split.display, reasoningContent),
  );

  return {
    displayContent,
    reasoningContent,
    thinkingStarted: split.started || fallbackReasoning.length > 0,
    thinkingInProgress: split.inProgress,
  };
}

import { isAbsoluteFilePath } from "../../utils/workspace-file-path";

/** Inline code spans — leave literal backtick content unchanged. */
const INLINE_CODE_RE = /(`[^`\n]+`)/g;

type FenceLine = {
  indent: number;
  marker: "`" | "~";
  length: number;
  info: string;
};

/** CommonMark fence line: 0–3 spaces, 3+ backticks/tildes, optional info string. */
function parseFenceLine(line: string): FenceLine | null {
  const match = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const ticks = match[2];
  const marker = ticks[0] as "`" | "~";
  const info = match[3];
  if (marker === "`" && info.includes("`")) return null;
  return { indent: match[1].length, marker, length: ticks.length, info };
}

function isFenceCloser(opener: FenceLine, candidate: FenceLine): boolean {
  return (
    candidate.marker === opener.marker &&
    candidate.length >= opener.length &&
    candidate.indent <= opener.indent &&
    candidate.info.trim() === ""
  );
}

function findFenceCloser(lines: string[], openerIndex: number, opener: FenceLine): number {
  for (let index = openerIndex + 1; index < lines.length; index += 1) {
    const candidate = parseFenceLine(lines[index]);
    if (candidate && isFenceCloser(opener, candidate)) return index;
  }
  return -1;
}

/**
 * Models wrap a whole prompt in ```markdown and then nest ``` error dumps inside.
 * CommonMark closes the outer fence at the first same-length ``` (even if indented 1–3 spaces).
 * Lift the outer fence so remark keeps one copyable block.
 */
function repairNestedMarkdownFences(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const opener = parseFenceLine(lines[index]);
    if (!opener) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    const closer = findFenceCloser(lines, index, opener);
    if (closer < 0) {
      out.push(...lines.slice(index));
      break;
    }
    const content = lines.slice(index + 1, closer);
    let maxInnerLength = 0;
    for (const line of content) {
      const inner = parseFenceLine(line);
      if (inner && inner.marker === opener.marker) {
        maxInnerLength = Math.max(maxInnerLength, inner.length);
      }
    }
    const outerLength = maxInnerLength >= opener.length ? maxInnerLength + 1 : opener.length;
    const indent = " ".repeat(opener.indent);
    const ticks = opener.marker.repeat(outerLength);
    out.push(`${indent}${ticks}${opener.info}`);
    out.push(...content);
    out.push(`${indent}${ticks}`);
    index = closer + 1;
  }
  return out.join("\n");
}

function mapFencedAndProse(text: string, onProse: (chunk: string) => string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  let proseLines: string[] = [];
  const flushProse = () => {
    if (proseLines.length === 0) return;
    out.push(onProse(proseLines.join("\n")));
    proseLines = [];
  };
  while (index < lines.length) {
    const opener = parseFenceLine(lines[index]);
    if (!opener) {
      proseLines.push(lines[index]);
      index += 1;
      continue;
    }
    const closer = findFenceCloser(lines, index, opener);
    flushProse();
    if (closer < 0) {
      out.push(lines.slice(index).join("\n"));
      break;
    }
    out.push(lines.slice(index, closer + 1).join("\n"));
    index = closer + 1;
  }
  flushProse();
  return out.join("\n");
}

/** Standalone line that is only an absolute file path (not already in backticks). */
const STANDALONE_ABS_PATH_LINE_RE =
  /^(\/(?:Users|home|tmp|var|opt|private|Volumes)[^\s\n`<>[\]()]+)$/gm;

/** Capture group for an absolute local path (Unicode filenames allowed). */
const INLINE_ABS_PATH_CAPTURE =
  "(\\/(?:Users|home|tmp|var|opt|private|Volumes)[^\\s\\n`<>\\[\\]()]+|[a-zA-Z]:[\\\\/][^\\s\\n`<>\\[\\]()]+|~/[^\\s\\n`<>\\[\\]()]+)";

/** Labels models use when declaring on-disk artifacts (automation / cron tasks). */
const SAVED_FILE_LABEL =
  "(?:报告已保存(?:至|到)|文件已保存(?:至|到)|报告(?:文件)?已落盘(?:至|到)?|已保存(?:至|到)|saved\\s+to|written\\s+to|report\\s+saved\\s+to|file\\s+saved\\s+to)";

const HTML_COMMENT_SAVED_PATH_RE = new RegExp(
  `<!--\\s*(${SAVED_FILE_LABEL}[：:\\s]*)${INLINE_ABS_PATH_CAPTURE}\\s*-->`,
  "gi",
);

const INLINE_LABELED_SAVED_PATH_RE = new RegExp(
  `(${SAVED_FILE_LABEL}[：:\\s]+)${INLINE_ABS_PATH_CAPTURE}(?=[\\s.,;:!?，。；：！？）\\])\\n]|$)`,
  "gi",
);

function wrapPathInBackticks(path: string): string | null {
  const trimmed = path.trim();
  return isAbsoluteFilePath(trimmed) ? `\`${trimmed}\`` : null;
}

/** Turn `<!-- 报告已保存至: /path -->` into visible `报告已保存至: `/path``. */
function unwrapHtmlCommentSavedPaths(text: string): string {
  return text.replace(HTML_COMMENT_SAVED_PATH_RE, (whole, label: string, path: string) => {
    const wrapped = wrapPathInBackticks(path);
    if (!wrapped) return whole;
    const prefix = String(label || "").trimEnd();
    return prefix ? `${prefix} ${wrapped}` : wrapped;
  });
}

/** Linkify labeled absolute paths in prose, e.g. `已保存至: /Users/.../report.md`. */
function wrapInlineLabeledSavedPaths(text: string): string {
  return text.replace(INLINE_LABELED_SAVED_PATH_RE, (whole, label: string, path: string) => {
    const wrapped = wrapPathInBackticks(path);
    if (!wrapped) return whole;
    if (whole.includes("`")) return whole;
    return `${label}${wrapped}`;
  });
}

/** Full-width asterisk (U+FF0A) and similar look-alikes → ASCII `*`. */
function normalizeAsteriskChars(text: string): string {
  return text.replace(/\uFF0A/g, "*");
}

/** Collapse LLM typos like `** **` into a single `**` delimiter pair opener/closer. */
function collapseSpacedStrongDelimiters(text: string): string {
  let next = text;
  let prev = "";
  while (prev !== next) {
    prev = next;
    next = next.replace(/\*\*\s+\*\*/g, "**");
  }
  return next;
}

function countStrongDelimiters(text: string): number {
  return (text.match(/\*\*/g) ?? []).length;
}

/** During streaming, auto-close a dangling `**` so partial bold does not leak literal asterisks. */
function closeUnclosedStrongDelimitersInProse(text: string): string {
  const proseOnly = text.split(INLINE_CODE_RE).filter((_, idx) => idx % 2 === 0);
  const delimiterCount = proseOnly.reduce((sum, part) => sum + countStrongDelimiters(part), 0);
  if (delimiterCount % 2 === 0) return text;
  return `${text}**`;
}

export type NormalizeChatMarkdownOptions = {
  /** When true, temporarily close an unclosed trailing `**` for render-only preview. */
  isStreaming?: boolean;
};

/**
 * LLMs often emit spaced emphasis delimiters (`** title**`, `__ foo __`).
 * CommonMark requires flanking without inner whitespace, so remark leaves them as literal asterisks.
 */
export function normalizeLenientEmphasisInText(text: string): string {
  if (!text) return text;
  let next = normalizeAsteriskChars(text);
  next = collapseSpacedStrongDelimiters(next);
  // Typo: `**price** *` / `**price** *输出` — strip before inner-space trim so ` **` is not merged into `***`
  next = next.replace(
    /(\*\*[^*\n]+?\*\*)\s+\*(?=$|[\s.,;:!?，。；：！？）、」』】]|[\u4e00-\u9fff])/g,
    "$1",
  );
  // Trim spaces inside matched **…** / __…__ spans only (preserve outer word spacing)
  next = next.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, "**$1**");
  next = next.replace(/__\s*([^_\n]+?)\s*__/g, "__$1__");
  return next;
}

function normalizeLatexMathDelimitersInText(text: string): string {
  let next = text;
  next = next.replace(/\\\[((?:.|\n)*?)\\\]/g, (_whole, expr: string) => {
    const inner = expr.trim();
    return inner ? `$$\n${inner}\n$$` : _whole;
  });
  next = next.replace(/\\\((.+?)\\\)/g, (_whole, expr: string) => {
    const inner = expr.trim();
    return inner ? `$${inner}$` : _whole;
  });
  return next;
}

function wrapStandaloneAbsoluteFilePaths(text: string): string {
  return text.replace(STANDALONE_ABS_PATH_LINE_RE, (match) => {
    const trimmed = match.trim();
    return wrapPathInBackticks(trimmed) ?? match;
  });
}

function wrapAutomationSavedFilePaths(text: string): string {
  let next = unwrapHtmlCommentSavedPaths(text);
  next = wrapInlineLabeledSavedPaths(next);
  next = wrapStandaloneAbsoluteFilePaths(next);
  return next;
}

function normalizeProseChunk(chunk: string, options?: NormalizeChatMarkdownOptions): string {
  const proseChunks = chunk.split(INLINE_CODE_RE);
  let next = proseChunks
    .map((prose, proseIdx) =>
      proseIdx % 2 === 1
        ? prose
        : wrapAutomationSavedFilePaths(
            normalizeLenientEmphasisInText(normalizeLatexMathDelimitersInText(prose)),
          ),
    )
    .join("");
  if (options?.isStreaming) {
    next = closeUnclosedStrongDelimitersInProse(next);
  }
  return next;
}

export function normalizeChatMarkdownContent(
  raw: string,
  options?: NormalizeChatMarkdownOptions,
): string {
  if (!raw) return raw;
  const repaired = repairNestedMarkdownFences(raw);
  return mapFencedAndProse(repaired, (chunk) => normalizeProseChunk(chunk, options));
}

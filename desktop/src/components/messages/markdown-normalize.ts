import { isAbsoluteFilePath } from "../../utils/workspace-file-path";

/** Inline code spans — leave literal backtick content unchanged. */
const INLINE_CODE_RE = /(`[^`\n]+`)/g;

const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

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
  const fencedChunks = raw.split(FENCED_BLOCK_RE);
  return fencedChunks
    .map((chunk, idx) => (idx % 2 === 1 ? chunk : normalizeProseChunk(chunk, options)))
    .join("");
}

/** Inline code spans — leave literal backtick content unchanged. */
const INLINE_CODE_RE = /(`[^`\n]+`)/g;

const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

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

function normalizeProseChunk(chunk: string, options?: NormalizeChatMarkdownOptions): string {
  const proseChunks = chunk.split(INLINE_CODE_RE);
  let next = proseChunks
    .map((prose, proseIdx) =>
      proseIdx % 2 === 1
        ? prose
        : normalizeLenientEmphasisInText(normalizeLatexMathDelimitersInText(prose)),
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

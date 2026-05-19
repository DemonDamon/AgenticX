/** Inline code spans — leave literal backtick content unchanged. */
const INLINE_CODE_RE = /(`[^`\n]+`)/g;

const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/**
 * LLMs often emit spaced emphasis delimiters (`** title**`, `__ foo __`).
 * CommonMark requires flanking without inner whitespace, so remark leaves them as literal asterisks.
 */
export function normalizeLenientEmphasisInText(text: string): string {
  if (!text) return text;
  let next = text;
  // Typo: `**price** *` — strip before inner-space trim so ` **` is not merged into `***`
  next = next.replace(
    /(\*\*[^*\n]+?\*\*)\s+\*(?=$|[\s.,;:!?，。；：！？）、」』】])/g,
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

function normalizeProseChunk(chunk: string): string {
  const proseChunks = chunk.split(INLINE_CODE_RE);
  return proseChunks
    .map((prose, proseIdx) =>
      proseIdx % 2 === 1
        ? prose
        : normalizeLenientEmphasisInText(normalizeLatexMathDelimitersInText(prose)),
    )
    .join("");
}

export function normalizeChatMarkdownContent(raw: string): string {
  if (!raw) return raw;
  const fencedChunks = raw.split(FENCED_BLOCK_RE);
  return fencedChunks
    .map((chunk, idx) => (idx % 2 === 1 ? chunk : normalizeProseChunk(chunk)))
    .join("");
}

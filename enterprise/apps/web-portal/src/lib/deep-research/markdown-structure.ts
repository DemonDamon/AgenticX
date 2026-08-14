/** Shared Markdown structure primitives for report parsing and verification. */

const FENCE_LINE_RE = /^\s*(?:```|~~~)/u;
const HEADING_LINE_RE = /^\s{0,3}#{1,6}\s/u;
const TABLE_DIVIDER_LINE_RE = /^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/u;
/** CJK terminators need no following space; Latin periods do. */
const SENTENCE_BOUNDARY_RE =
  /(?<=[。！？；!?;])\s*|(?<=\.)\s+(?=[A-Z(\[])/u;

export function isMarkdownFenceLine(line: string): boolean {
  return FENCE_LINE_RE.test(line);
}

export function isMarkdownHeadingLine(line: string): boolean {
  return HEADING_LINE_RE.test(line);
}

export function isMarkdownTableDividerLine(line: string): boolean {
  return TABLE_DIVIDER_LINE_RE.test(line);
}

export function splitMarkdownSentences(text: string): string[] {
  return text.split(SENTENCE_BOUNDARY_RE);
}

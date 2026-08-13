/**
 * HTML → main text extraction (shared by native backend).
 * Algorithm must stay stable; covered by page-fetch.test.ts.
 */

/** 单篇正文抓取上限；超出截断。 */
export const MAX_PAGE_CHARS = 12_000;
/** 正文短于此值视为抓取失败（多半是 JS 渲染页 / 反爬墙）。 */
export const MIN_USABLE_PAGE_CHARS = 400;

const NOISE_TAGS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "svg",
  "iframe",
] as const;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** Extract the standard HTML document title without coupling to a site layout. */
export function extractDocumentTitle(html: string): string | undefined {
  const lower = html.toLowerCase();
  const titleStart = lower.indexOf("<title");
  if (titleStart < 0) return undefined;
  const contentStart = lower.indexOf(">", titleStart);
  if (contentStart < 0) return undefined;
  const contentEnd = lower.indexOf("</title>", contentStart + 1);
  if (contentEnd < 0) return undefined;
  const title = normalizeWhitespace(
    decodeEntities(html.slice(contentStart + 1, contentEnd)),
  );
  return title ? title.slice(0, 300) : undefined;
}

function stripNoiseTags(html: string): string {
  let out = html;
  for (const tag of NOISE_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
  }
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}

function matchLongest(html: string, re: RegExp): string | null {
  let best: string | null = null;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1] ?? "";
    if (!best || body.length > best.length) best = body;
  }
  return best;
}

function pickMainHtml(html: string): string {
  const article = matchLongest(html, /<article\b[^>]*>([\s\S]*?)<\/article>/gi);
  const main = matchLongest(html, /<main\b[^>]*>([\s\S]*?)<\/main>/gi);
  const contentDiv = matchLongest(
    html,
    /<div\b[^>]*(?:id|class)="[^"]*\b(?:content|article|post|main)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  );
  const candidates = [article, main, contentDiv].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  const body = matchLongest(html, /<body\b[^>]*>([\s\S]*?)<\/body>/gi);
  return body ?? html;
}

function blockTagsToNewlines(html: string): string {
  return html
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从 HTML 提取正文纯文本（导出以便单测）。 */
export function extractMainText(html: string): string {
  const cleaned = stripNoiseTags(html);
  const main = pickMainHtml(cleaned);
  const withBreaks = blockTagsToNewlines(main);
  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeEntities(noTags));
}

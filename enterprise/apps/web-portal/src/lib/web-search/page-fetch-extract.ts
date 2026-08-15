/**
 * HTML → main text extraction (shared by native backend).
 *
 * No site knowledge and no per-layout rules. Three stages, each with one job:
 *
 * 1. remove the elements whose text is never content (script/style/nav/…),
 *    nesting-aware, so nothing downstream has to discount them again;
 * 2. score every container element by the text it holds that is NOT link text —
 *    a menu or a "related articles" rail is made of anchors, prose is not;
 * 3. descend from the winner into the tightest nested block that still keeps
 *    nearly all of that prose, so a wrapper loses to the article it wraps.
 *
 * The previous version matched containers with a non-greedy
 * `<div ...>([\s\S]*?)</div>`, which stops at the FIRST inner `</div>`. Any
 * article body with nested markup was cut off mid-way, so a flat navigation
 * container could out-measure it and win — which is why two major Chinese
 * financial sites yielded their top menu instead of their article. It also had
 * a hand-maintained list of "content-ish" id/class names; structure and link
 * density replace it, so that list is gone.
 *
 * Covered by page-fetch.test.ts, including fixtures for those two layouts.
 */

/** 单篇正文抓取上限；超出截断。 */
export const MAX_PAGE_CHARS = 12_000;
/** 正文短于此值视为抓取失败（多半是 JS 渲染页 / 反爬墙）。 */
export const MIN_USABLE_PAGE_CHARS = 400;

/** Elements whose text is never page content. Removed before anything is scored. */
const NOISE_TAGS = new Set([
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
  "template",
  "select",
  "button",
]);

/** Elements that can hold a block of prose and are therefore worth scoring. */
const CONTAINER_TAGS = new Set(["body", "article", "main", "section", "div", "td"]);

/** Never carry a closing tag, so they must not open a range on the stack. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Raw text elements: `<` inside them never opens a tag, so their content ends
 * only at their own closing tag (or the end of the document). Parsing their
 * bodies as markup is not a small inaccuracy — `if (a<b)` in an inline script
 * makes `<b …</script>` scan as a `b` element that eats the real closing tag,
 * the script never closes, and the EOF cleanup then removes the whole page.
 */
const RAW_TEXT_TAGS = new Set(["script", "style"]);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;

/** Offset of this element's own closing tag, or -1 if it never closes. */
function rawTextEnd(html: string, name: string, from: number): number {
  const close = new RegExp(`</${name}(?=[\\s/>])`, "iu");
  const found = html.slice(from).search(close);
  return found < 0 ? -1 : from + found;
}

type Tag = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** Offset of `<`. */
  start: number;
  /** Offset just past `>`. */
  end: number;
  /** Non-space characters before this tag, and how many of them were link text. */
  textBefore: number;
  linkBefore: number;
};

type Range = {
  /** Content bounds: just past the opening tag, up to the closing tag. */
  start: number;
  end: number;
  /** Element bounds, tags included — what removal has to operate on. */
  outerStart: number;
  outerEnd: number;
  text: number;
  link: number;
};

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

function countNonSpace(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 32) count += 1;
  }
  return count;
}

/**
 * Single pass over the tag stream, carrying running totals of visible text and
 * of text sitting inside an anchor. A tag itself contributes no text, so a
 * total taken at a tag's start is also the total just past its end — which is
 * what makes the range arithmetic below exact.
 */
function scanTags(html: string): { tags: Tag[]; text: number; link: number } {
  const tags: Tag[] = [];
  let cursor = 0;
  let text = 0;
  let linkText = 0;
  let anchorDepth = 0;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(html)) !== null) {
    const visible = countNonSpace(html.slice(cursor, match.index));
    text += visible;
    if (anchorDepth > 0) linkText += visible;

    const name = (match[2] ?? "").toLowerCase();
    const closing = match[1] === "/";
    const selfClosing = match[3] === "/" || VOID_TAGS.has(name);

    tags.push({
      name,
      closing,
      selfClosing,
      start: match.index,
      end: match.index + match[0].length,
      textBefore: text,
      linkBefore: linkText,
    });

    if (name === "a" && !selfClosing) {
      anchorDepth = closing ? Math.max(0, anchorDepth - 1) : anchorDepth + 1;
    }
    cursor = match.index + match[0].length;

    if (!closing && !selfClosing && RAW_TEXT_TAGS.has(name)) {
      // Resume scanning at this element's own closing tag; everything in
      // between is text, whatever it looks like.
      const end = rawTextEnd(html, name, cursor);
      if (end < 0) break;
      TAG_RE.lastIndex = end;
    }
  }
  const trailing = countNonSpace(html.slice(cursor));
  return { tags, text: text + trailing, link: linkText + (anchorDepth > 0 ? trailing : 0) };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index;
  }
  return -1;
}

/**
 * Nesting-aware ranges for the requested element names. One stack walk; an
 * unclosed tag is tolerated by popping down to the nearest matching name.
 *
 * Anything still open at the end of the document is closed there, exactly as a
 * browser would. This is not a nicety: page HTML is truncated before it reaches
 * here, so a `<script>` routinely has no closing tag, and a scan that only
 * recognised closed elements let ten thousand characters of script source
 * through as if it were prose.
 */
function collectRanges(
  tags: readonly Tag[],
  names: ReadonlySet<string>,
  documentEnd: number,
  totalText: number,
  totalLink: number,
): Range[] {
  const ranges: Range[] = [];
  const open: Tag[] = [];

  for (const tag of tags) {
    if (tag.selfClosing || !names.has(tag.name)) continue;
    if (!tag.closing) {
      open.push(tag);
      continue;
    }
    const at = findLastIndex(open, (candidate) => candidate.name === tag.name);
    if (at < 0) continue;
    const start = open[at] as Tag;
    open.length = at;
    ranges.push({
      start: start.end,
      end: tag.start,
      outerStart: start.start,
      outerEnd: tag.end,
      text: tag.textBefore - start.textBefore,
      link: tag.linkBefore - start.linkBefore,
    });
  }

  for (const start of open) {
    ranges.push({
      start: start.end,
      end: documentEnd,
      outerStart: start.start,
      outerEnd: documentEnd,
      text: totalText - start.textBefore,
      link: totalLink - start.linkBefore,
    });
  }
  return ranges;
}

/**
 * Blank out every noise element, tags included, before anything is measured.
 * Doing this first is what keeps scoring honest: otherwise an inline script
 * counts as text for the block that holds it, and the discount has to be
 * re-applied at every ancestor.
 */
function stripNoise(html: string): string {
  const scan = scanTags(html);
  const ranges = collectRanges(scan.tags, NOISE_TAGS, html.length, scan.text, scan.link)
    .slice()
    .sort((a, b) => a.outerStart - b.outerStart);

  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    // Whole elements, opening and closing tags included. Removing only the
    // content left `<script ...` and `</script>` shells behind, which the later
    // tag strip then had to guess at. Ranges nest, so an inner one is already
    // covered by the outer.
    if (range.outerStart < cursor) continue;
    out += html.slice(cursor, range.outerStart);
    out += " ";
    cursor = range.outerEnd;
  }
  return out + html.slice(cursor);
}

/** Text that is not link text. A menu is anchors; prose is not. */
function proseOf(range: Range): number {
  return range.text - range.link;
}

/** Prose per character of markup: how much of a block is actually content. */
function densityOf(range: Range): number {
  return proseOf(range) / Math.max(1, range.end - range.start);
}

function contains(outer: Range, inner: Range): boolean {
  return (
    inner.start >= outer.start &&
    inner.end <= outer.end &&
    (inner.start > outer.start || inner.end < outer.end)
  );
}

/**
 * Most prose first, then tighten.
 *
 * Ranking by prose alone always lands on the outermost wrapper, because a
 * wrapper never holds less prose than what it wraps — so the page shell wins
 * and drags its menus in. Ranking by density alone lands on a one-line
 * disclaimer. So: take the block with the most prose, then walk inward while a
 * nested block keeps essentially all of it in tighter markup.
 *
 * `WRAPPER_MIN_SHARE` is the one tuned number here, and it says something
 * plain: a wrapper earns its extra chrome only by adding more than a quarter of
 * the prose — below that, whatever it added was not the article.
 */
const WRAPPER_MIN_SHARE = 0.75;

function pickMainRange(html: string, ranges: readonly Range[]): Range {
  const whole: Range = {
    start: 0,
    end: html.length,
    outerStart: 0,
    outerEnd: html.length,
    text: 0,
    link: 0,
  };
  const scored = ranges.filter((range) => proseOf(range) > 0);
  if (scored.length === 0) return whole;

  let best = scored[0] as Range;
  for (const range of scored) {
    if (proseOf(range) > proseOf(best)) best = range;
  }

  for (;;) {
    const floor = proseOf(best) * WRAPPER_MIN_SHARE;
    let tighter: Range | null = null;
    for (const range of scored) {
      if (!contains(best, range) || proseOf(range) < floor) continue;
      if (!tighter || densityOf(range) > densityOf(tighter)) tighter = range;
    }
    if (!tighter || densityOf(tighter) <= densityOf(best)) return best;
    best = tighter;
  }
}

function blockTagsToNewlines(html: string): string {
  return html
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
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
  const cleaned = stripNoise(html.replace(/<!--[\s\S]*?-->/g, " "));
  const scan = scanTags(cleaned);
  const ranges = collectRanges(
    scan.tags,
    CONTAINER_TAGS,
    cleaned.length,
    scan.text,
    scan.link,
  );
  const main = pickMainRange(cleaned, ranges);
  const withBreaks = blockTagsToNewlines(cleaned.slice(main.start, main.end));
  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeEntities(noTags));
}

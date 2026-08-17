/**
 * Self-contained interactive HTML report for deep-research deliverables.
 * No external npm markdown deps — small inline converter + Mermaid CDN with <pre> fallback.
 */

import type { Citation } from "./registry";
import {
  chartSpecToGfmTable,
  chartSpecToSvg,
  chartSpecToXyChart,
  parseChartSpec,
} from "./report-chart";

export type HtmlReportInput = {
  title: string;
  topic: string;
  markdown: string;
  citations: Citation[];
  mindmapMermaid: string;
  stats?: {
    queriesPlanned: number;
    urlsDiscovered: number;
    sourcesSelected: number;
    pagesFetched: number;
  };
  generatedAt: string;
};

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeHref(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "#";
  // In-document anchors (citations `#ref-N`, TOC `#section`) must stay fragment-only.
  // Stripping them to bare `#` breaks scroll + lets sandboxed srcDoc navigate the parent.
  if (trimmed.startsWith("#")) {
    const id = trimmed.slice(1);
    if (!id) return "#";
    // Disallow whitespace / control chars in fragment ids.
    if (/[\s\0]/.test(id)) return "#";
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") return trimmed;
    return "#";
  } catch {
    return "#";
  }
}

function slugifyHeading(text: string, used: Map<string, number>): string {
  let base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

type TocEntry = { id: string; text: string; level: number };

function inlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) => {
      const safe = safeHref(href);
      return `<a href="${escapeHtml(safe)}">${label}</a>`;
    },
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

/** Minimal Markdown → HTML (headings, lists, paragraphs, code fences, tables, inline). */
export function markdownToHtml(markdown: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const usedIds = new Map<string, number>();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    const text = buf.join("\n").trim();
    if (!text) return;
    blocks.push(`<p>${inlineMarkdown(text).replace(/\n/g, "<br />")}</p>`);
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      const source = codeLines.join("\n");
      const langLower = lang.toLowerCase();
      if (langLower === "mermaid") {
        const escaped = escapeHtml(source);
        blocks.push(
          `<div class="mermaid-wrap"><pre class="mermaid">${escaped}</pre><pre class="mermaid-fallback" hidden>${escaped}</pre></div>`,
        );
      } else if (langLower === "chart") {
        const spec = parseChartSpec(source);
        const xyChart = spec ? chartSpecToXyChart(spec) : null;
        if (xyChart) {
          const escaped = escapeHtml(xyChart);
          blocks.push(
            `<div class="mermaid-wrap"><pre class="mermaid">${escaped}</pre><pre class="mermaid-fallback" hidden>${escaped}</pre></div>`,
          );
        } else if (spec) {
          const svg = chartSpecToSvg(spec);
          if (svg) {
            blocks.push(`<div class="chart-wrap">${svg}</div>`);
          } else {
            blocks.push(markdownToHtml(chartSpecToGfmTable(spec)).html);
          }
        } else {
          blocks.push(`<pre><code class="language-chart">${escapeHtml(source)}</code></pre>`);
        }
      } else {
        const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
        blocks.push(
          `<pre><code${langAttr}>${escapeHtml(source)}</code></pre>`,
        );
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      const id = slugifyHeading(text, usedIds);
      toc.push({ id, text, level });
      blocks.push(
        `<h${level} id="${escapeHtml(id)}">${inlineMarkdown(text)}</h${level}>`,
      );
      i += 1;
      continue;
    }

    if (/^\|(.+)\|$/.test(line) && i + 1 < lines.length && /^\|[\s|:-]+\|$/.test(lines[i + 1] ?? "")) {
      const headerCells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|(.+)\|$/.test(lines[i] ?? "")) {
        rows.push(
          (lines[i] ?? "")
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim()),
        );
        i += 1;
      }
      const thead = `<thead><tr>${headerCells.map((c) => `<th>${inlineMarkdown(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`;
      blocks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        `<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        `<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`,
      );
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para: string[] = [];
    const paraStart = i;
    while (i < lines.length && (lines[i] ?? "").trim()) {
      const next = lines[i] ?? "";
      if (
        next.startsWith("#") ||
        next.startsWith("```") ||
        /^\s*[-*]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        /^\|(.+)\|$/.test(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    // A lone pipe row is not a table, but it also terminates the paragraph
    // scanner. Consume it explicitly so malformed model output cannot loop.
    if (i === paraStart) {
      para.push(line);
      i += 1;
    }
    flushParagraph(para);
  }

  return { html: blocks.join("\n"), toc };
}

function renderStats(stats: HtmlReportInput["stats"]): string {
  if (!stats) return "";
  const items = [
    ["规划查询", stats.queriesPlanned],
    ["发现链接", stats.urlsDiscovered],
    ["选用来源", stats.sourcesSelected],
    ...(stats.pagesFetched > 0
      ? [["抓取正文", stats.pagesFetched] as const]
      : []),
  ] as const;
  return `<div class="stats">${items
    .map(
      ([label, value]) =>
        `<div class="stat"><span class="stat-value">${escapeHtml(String(value))}</span><span class="stat-label">${label}</span></div>`,
    )
    .join("")}</div>`;
}

function renderSources(citations: Citation[]): string {
  if (citations.length === 0) {
    return `<section class="sources" id="sources"><h2>来源</h2><p class="muted">暂无来源</p></section>`;
  }
  const items = citations
    .map((c) => {
      if (c.sourceType === "attachment") {
        const label = c.sourceLabel || "用户上传文件";
        return `<li id="ref-${c.index}"><span class="ref-num">[${c.index}]</span> <span>${escapeHtml(c.title || label)}</span><span class="ref-url">${escapeHtml(label)} · 用户上传文件</span></li>`;
      }
      const href = safeHref(c.url);
      return `<li id="ref-${c.index}"><span class="ref-num">[${c.index}]</span> <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title || c.url)}</a><span class="ref-url">${escapeHtml(c.url)}</span></li>`;
    })
    .join("\n");
  return `<section class="sources" id="sources"><h2>来源</h2><ol class="source-list">${items}</ol></section>`;
}

function renderMindmap(mermaid: string): string {
  if (!mermaid.trim()) return "";
  const escaped = escapeHtml(mermaid);
  return `<section class="mindmap" id="mindmap">
  <h2>思维导图</h2>
  <div class="mermaid-wrap">
    <pre class="mermaid">${escaped}</pre>
    <pre class="mermaid-fallback" hidden>${escaped}</pre>
  </div>
</section>`;
}

const REPORT_CSS = `
:root {
  --bg: oklch(0.99 0 0);
  --fg: oklch(0.145 0 0);
  --muted: oklch(0.45 0.01 270);
  --border: oklch(0.92 0.005 270);
  --primary: oklch(0.52 0.22 275);
  --primary-soft: oklch(0.95 0.04 275);
  --accent: oklch(0.60 0.22 305);
  --card: oklch(1 0 0);
  --sidebar: oklch(0.985 0 0);
  --code-bg: oklch(0.96 0.01 270);
  --highlight: oklch(0.92 0.06 275);
  color-scheme: light;
}
html.dark {
  --bg: oklch(0.16 0.02 275);
  --fg: oklch(0.96 0.01 270);
  --muted: oklch(0.72 0.02 270);
  --border: oklch(0.28 0.02 275);
  --primary: oklch(0.72 0.16 275);
  --primary-soft: oklch(0.28 0.06 275);
  --accent: oklch(0.72 0.16 305);
  --card: oklch(0.20 0.02 275);
  --sidebar: oklch(0.18 0.02 275);
  --code-bg: oklch(0.24 0.02 275);
  --highlight: oklch(0.32 0.08 275);
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.7;
}
.layout { display: flex; min-height: 100vh; }
.sidebar {
  position: sticky; top: 0; align-self: flex-start;
  width: 260px; max-height: 100vh; overflow: auto;
  padding: 1.25rem 1rem; background: var(--sidebar);
  border-right: 1px solid var(--border); flex-shrink: 0;
}
.sidebar h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 0.75rem; }
.toc { list-style: none; padding: 0; margin: 0; }
.toc a {
  display: block; padding: 0.35rem 0.5rem; border-radius: 6px;
  color: var(--fg); text-decoration: none; font-size: 0.9rem;
}
.toc a:hover, .toc a.active { background: var(--primary-soft); color: var(--primary); }
.toc .l3 { padding-left: 1rem; font-size: 0.85rem; }
.main { flex: 1; min-width: 0; padding: 2rem 2.5rem 4rem; max-width: 920px; }
.topbar { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; margin-bottom: 1.25rem; }
.theme-toggle {
  flex-shrink: 0; width: 2rem; height: 2rem; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); background: var(--card); color: var(--fg);
  border-radius: 999px; cursor: pointer;
}
.theme-toggle:hover { background: var(--primary-soft); color: var(--primary); }
.theme-toggle svg { width: 1rem; height: 1rem; display: none; }
/* Light → show moon (switch to dark); dark → show sun (switch to light). */
html:not(.dark) .theme-toggle .icon-moon { display: block; }
html.dark .theme-toggle .icon-sun { display: block; }
h1 { font-size: 1.85rem; line-height: 1.3; margin: 0 0 0.35rem; }
.meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem; }
.stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0 1.5rem; }
.stat {
  background: var(--card); border: 1px solid var(--border); border-radius: 12px;
  padding: 0.65rem 0.9rem; min-width: 6.5rem;
}
.stat-value { display: block; font-weight: 700; color: var(--primary); font-size: 1.15rem; }
.stat-label { color: var(--muted); font-size: 0.75rem; }
.article h2 { margin-top: 2rem; scroll-margin-top: 1rem; }
.article h3 { scroll-margin-top: 1rem; }
.article a { color: var(--primary); }
.article code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
.article pre {
  background: var(--code-bg); padding: 1rem; border-radius: 10px; overflow: auto;
  border: 1px solid var(--border);
}
.article pre code { background: none; padding: 0; }
.article table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.92rem; }
.article th, .article td { border: 1px solid var(--border); padding: 0.45rem 0.6rem; text-align: left; }
.article th { background: var(--primary-soft); }
.sources { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
.source-list { list-style: none; padding: 0; }
.source-list li {
  padding: 0.65rem 0.75rem; border-radius: 8px; margin-bottom: 0.35rem;
  border: 1px solid transparent; scroll-margin-top: 1rem;
}
.source-list li:target, .source-list li.flash { background: var(--highlight); border-color: var(--primary); }
.ref-num { color: var(--accent); font-weight: 600; margin-right: 0.35rem; }
.ref-url { display: block; color: var(--muted); font-size: 0.8rem; margin-top: 0.15rem; word-break: break-all; }
.mindmap { margin-top: 2.5rem; }
.mermaid-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem; overflow: auto; }
.chart-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem; overflow: auto; }
.chart-figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.chart-title { font-weight: 600; }
.chart-legend { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; font-size: 0.85rem; color: var(--muted); justify-content: center; }
.chart-legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
.chart-dot { display: inline-block; width: 0.65rem; height: 0.65rem; border-radius: 9999px; }
.muted { color: var(--muted); }
@media print {
  .sidebar, .theme-toggle { display: none !important; }
  .layout { display: block; }
  .main { max-width: none; padding: 0; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #555; }
}
/* Mid width: keep TOC on the left (thinner), avoid dumping it above the article. */
@media (max-width: 860px) and (min-width: 521px) {
  .layout { flex-direction: row; }
  .sidebar {
    position: sticky; top: 0; align-self: flex-start;
    width: 180px; max-height: 100vh; overflow: auto;
    border-right: 1px solid var(--border); border-bottom: none;
  }
  .main { padding: 1.5rem 1.25rem 3rem; }
}
/* Very narrow: stack, but collapse TOC by default (click heading to expand). */
@media (max-width: 520px) {
  .layout { flex-direction: column; }
  .sidebar {
    position: sticky; top: 0; z-index: 10;
    width: 100%; max-height: none;
    border-right: none; border-bottom: 1px solid var(--border);
  }
  .sidebar:not(.toc-open) .toc { display: none; }
  .sidebar.toc-open .toc {
    display: block; max-height: min(50vh, 20rem); overflow: auto;
  }
  .sidebar > h2 {
    cursor: pointer; user-select: none; margin-bottom: 0;
    display: flex; align-items: center; justify-content: space-between;
  }
  .sidebar > h2::after {
    content: "▸"; color: var(--muted); font-size: 0.85rem;
  }
  .sidebar.toc-open > h2 { margin-bottom: 0.75rem; }
  .sidebar.toc-open > h2::after { content: "▾"; }
  .main { padding: 1.25rem 1.25rem 3rem; }
}
`.trim();

const REPORT_JS = `
(function () {
  var root = document.documentElement;
  var key = "dr-report-theme";
  function apply(mode) {
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem(key, mode); } catch (e) {}
  }
  var saved = null;
  try { saved = localStorage.getItem(key); } catch (e) {}
  if (saved === "dark" || saved === "light") apply(saved);
  else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) apply("dark");
  var btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", function () {
    apply(root.classList.contains("dark") ? "light" : "dark");
  });
  // srcDoc / sandboxed iframe: bare #hash links resolve against the parent
  // portal URL and can navigate the top window (e.g. kick users to login).
  // Keep in-document jumps local via preventDefault + scrollIntoView.
  function scrollToHash(href) {
    if (!href || href.charAt(0) !== "#") return false;
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (e) {}
    if (!id) return false;
    var target = document.getElementById(id);
    if (!target) return false;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      target.scrollIntoView(true);
    }
    if (id.indexOf("ref-") === 0) {
      target.classList.add("flash");
      setTimeout(function () { target.classList.remove("flash"); }, 1200);
    }
    return true;
  }
  document.addEventListener("click", function (event) {
    var node = event.target;
    var a = null;
    while (node && node !== document) {
      if (node.tagName === "A") { a = node; break; }
      node = node.parentNode;
    }
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) !== "#") return;
    // Always stop hash navigation escaping the sandbox (bare hash or missing targets).
    event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    scrollToHash(href);
  }, true);
  var links = document.querySelectorAll(".toc a");
  var sections = [];
  links.forEach(function (a) {
    var id = (a.getAttribute("href") || "").slice(1);
    var el = id ? document.getElementById(id) : null;
    if (el) sections.push({ a: a, el: el });
  });
  function onScroll() {
    var current = null;
    var y = window.scrollY + 80;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].el.offsetTop <= y) current = sections[i];
    }
    links.forEach(function (a) { a.classList.remove("active"); });
    if (current) current.a.classList.add("active");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  var sidebar = document.getElementById("toc") || document.querySelector(".sidebar");
  var narrowMq = window.matchMedia("(max-width: 520px)");
  function syncNarrowToc() {
    if (!sidebar) return;
    if (!narrowMq.matches) sidebar.classList.remove("toc-open");
  }
  if (sidebar) {
    var heading = sidebar.querySelector(":scope > h2");
    if (heading) {
      heading.addEventListener("click", function () {
        if (!narrowMq.matches) return;
        sidebar.classList.toggle("toc-open");
      });
    }
    if (narrowMq.addEventListener) narrowMq.addEventListener("change", syncNarrowToc);
    else if (narrowMq.addListener) narrowMq.addListener(syncNarrowToc);
    syncNarrowToc();
  }
  function showFallback() {
    document.querySelectorAll(".mermaid").forEach(function (el) { el.hidden = true; });
    document.querySelectorAll(".mermaid-fallback").forEach(function (el) { el.hidden = false; });
  }
  if (window.mermaid) {
    try {
      window.mermaid.initialize({ startOnLoad: true, theme: root.classList.contains("dark") ? "dark" : "default" });
    } catch (e) { showFallback(); }
  } else {
    showFallback();
  }
})();
`.trim();

/** Returns a single-file self-contained HTML document. */
export function renderHtmlReport(input: HtmlReportInput): string {
  const title = input.title.trim() || input.topic.trim() || "调研报告";
  const { html: bodyHtml, toc } = markdownToHtml(input.markdown);
  const tocHtml =
    toc.length === 0
      ? `<li class="muted">无目录</li>`
      : toc
          .map((entry) => {
            const cls = entry.level >= 3 ? ` class="l3"` : "";
            return `<li${cls}><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a></li>`;
          })
          .join("\n");

  const mindmapBlock = renderMindmap(input.mindmapMermaid);
  const bodyHasMermaid = bodyHtml.includes('class="mermaid"');
  const needMermaid = Boolean(input.mindmapMermaid.trim()) || bodyHasMermaid;
  const mermaidScript = needMermaid
    ? `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" onerror="document.querySelectorAll('.mermaid').forEach(function(e){e.hidden=true});document.querySelectorAll('.mermaid-fallback').forEach(function(e){e.hidden=false})"></script>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar" id="toc">
    <h2>目录</h2>
    <ul class="toc">
${tocHtml}
    </ul>
  </aside>
  <main class="main">
    <div class="topbar">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">主题：${escapeHtml(input.topic || title)} · 生成于 ${escapeHtml(input.generatedAt)}</div>
      </div>
      <button type="button" class="theme-toggle" id="theme-toggle" aria-label="明暗切换" title="明暗切换">
        <svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        <svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      </button>
    </div>
    ${renderStats(input.stats)}
    <article class="article">
${bodyHtml}
    </article>
    ${mindmapBlock}
    ${renderSources(input.citations)}
  </main>
</div>
${mermaidScript}
<script>
${REPORT_JS}
</script>
</body>
</html>
`;
}

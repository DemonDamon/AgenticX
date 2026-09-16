import type { PortalLocale } from "../../i18n/chat-copy";

/**
 * Display-only remap of canned TOC chrome we inject into reports.
 * Does not mutate stored artifacts; download paths must keep the raw file.
 */
export function localizeReportChrome(text: string, locale: PortalLocale): string {
  if (!text || locale !== "en") return text;
  return text
    .replace(/^## 目录\s*$/gm, "## Contents")
    .replace(/<h2>目录<\/h2>/g, "<h2>Contents</h2>")
    .replace(/<li class="muted">无目录<\/li>/g, '<li class="muted">No contents</li>');
}

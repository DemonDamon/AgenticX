/**
 * Inject Near app theme into HTML preview srcDoc so pages/SVGs can follow light/dim/dark.
 *
 * Author: Damon Li
 */

import { collectThemeCssVars } from "./widget-theme";

export type HtmlPreviewAppTheme = "dark" | "light" | "dim";

const THEME_MARK = "__agxHtmlPreviewTheme";

function colorSchemeForTheme(theme: HtmlPreviewAppTheme): "light" | "dark" {
  return theme === "light" ? "light" : "dark";
}

/**
 * Strip a previous theme injection so re-injecting after theme switch stays idempotent.
 */
export function stripHtmlPreviewTheme(html: string): string {
  let src = String(html ?? "");
  src = src.replace(/<meta\b[^>]*\bdata-agx-preview-theme\b[^>]*>\s*/gi, "");
  src = src.replace(
    /<style\b[^>]*\bdata-agx-preview-theme\b[^>]*>[\s\S]*?<\/style>\s*/gi,
    "",
  );
  src = src.replace(
    /(<html\b[^>]*?)\sdata-theme=(["'])(?:light|dark|dim)\2/gi,
    "$1",
  );
  src = src.replace(
    /(<html\b[^>]*?)\sstyle=(["'])color-scheme:\s*(?:light|dark)\s*;?\2/gi,
    "$1",
  );
  return src;
}

/**
 * Inject `data-theme`, `color-scheme`, and Near CSS variables into HTML preview srcDoc.
 * External SVG `<img>` assets that use `@media (prefers-color-scheme: …)` will follow
 * the forced color-scheme of this document in Chromium/Electron.
 */
export function injectHtmlPreviewTheme(
  html: string,
  theme: HtmlPreviewAppTheme,
): string {
  let src = stripHtmlPreviewTheme(String(html ?? ""));
  if (!src) return src;

  const scheme = colorSchemeForTheme(theme);
  const cssVars = collectThemeCssVars();
  const rootDecls = [`color-scheme: ${scheme}`, cssVars, `--agx-app-theme: ${theme}`]
    .filter(Boolean)
    .join("; ");

  const snippet = [
    `<meta name="color-scheme" content="${scheme}" data-agx-preview-theme="${THEME_MARK}">`,
    `<style data-agx-preview-theme="${THEME_MARK}">:root, html { ${rootDecls} }</style>`,
  ].join("");

  const htmlOpen = /<html\b[^>]*>/i;
  if (htmlOpen.test(src)) {
    src = src.replace(htmlOpen, (match) => {
      const cleaned = match
        .replace(/\sdata-theme=(["'])[^"']*\1/i, "")
        .replace(/\sstyle=(["'])color-scheme:\s*(?:light|dark)\s*;?\1/i, "");
      return cleaned.replace(/>$/, ` data-theme="${theme}" style="color-scheme: ${scheme}">`);
    });
  } else {
    src = `<html data-theme="${theme}" style="color-scheme: ${scheme}">${src}</html>`;
  }

  const headOpen = /<head\b[^>]*>/i;
  if (headOpen.test(src)) {
    return src.replace(headOpen, (match) => `${match}${snippet}`);
  }

  const bodyOpen = /<body\b[^>]*>/i;
  if (bodyOpen.test(src)) {
    return src.replace(bodyOpen, `<head>${snippet}</head>$&`);
  }

  return `${snippet}${src}`;
}

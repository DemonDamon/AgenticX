/**
 * Rewrite LLM-authored dark-only SVG palettes to Near theme CSS variables
 * so inline chat widgets follow light / dim / dark.
 *
 * Author: Damon Li
 */

/** Hardcoded fills/strokes/stop-colors commonly emitted by models (GitHub-dark etc.). */
const COLOR_TO_THEME_VAR: Record<string, string> = {
  // Full-canvas / page backgrounds
  "#0d1117": "var(--surface-base-fallback)",
  "#010409": "var(--surface-base-fallback)",
  "#0a0a0a": "var(--surface-base-fallback)",
  "#0a0e14": "var(--surface-base-fallback)",
  "#0f1419": "var(--surface-base-fallback)",
  "#111111": "var(--surface-base-fallback)",
  "#111827": "var(--surface-base-fallback)",
  "#121212": "var(--surface-base-fallback)",
  "#1a1a1a": "var(--surface-base-fallback)",
  "#1a1b1e": "var(--surface-base-fallback)",
  "#1c1c1e": "var(--surface-base-fallback)",
  "#050505": "var(--surface-base-fallback)",
  // Secondary panels
  "#161b22": "var(--surface-popover)",
  "#1f2937": "var(--surface-popover)",
  "#26262a": "var(--surface-popover)",
  "#2d2d30": "var(--surface-popover)",
  // Tracks / dividers
  "#21262d": "var(--svg-track)",
  "#30363d": "var(--border-subtle)",
  "#374151": "var(--border-subtle)",
  // Primary / body text (light-on-dark → theme text)
  "#e6edf3": "var(--text-primary)",
  "#e6e7ea": "var(--text-primary)",
  "#f0f6fc": "var(--text-primary)",
  "#f3f4f6": "var(--text-primary)",
  "#c9d1d9": "var(--text-primary)",
  "#d1d5db": "var(--text-primary)",
  "#e5e7eb": "var(--text-primary)",
  // Muted / faint
  "#8b949e": "var(--text-muted)",
  "#6e7681": "var(--text-muted)",
  "#848d97": "var(--text-muted)",
  "#9ca3af": "var(--text-muted)",
  "#6b7280": "var(--text-muted)",
  "#484f58": "var(--text-faint)",
  "#4b5563": "var(--text-faint)",
  // Tinted scenario / status cards (dark greens/yellows/reds)
  "#0d2818": "var(--svg-card-green)",
  "#052e16": "var(--svg-card-green)",
  "#1a1a0d": "var(--svg-card-yellow)",
  "#1c1917": "var(--svg-card-yellow)",
  "#1a0d0d": "var(--svg-card-red)",
  "#450a0a": "var(--svg-card-red)",
};

const ATTR_NAMES = ["fill", "stroke", "stop-color", "stopColor", "color"] as const;

// Define on :root/html only — do NOT set on `svg` itself, or light overrides on
// `html[data-theme]` would be shadowed by the svg element's own dark values.
const CARD_TINT_STYLE = `
:root {
  --svg-card-green: #0d2818;
  --svg-card-yellow: #1a1a0d;
  --svg-card-red: #1a0d0d;
  --svg-track: #21262d;
}
html[data-theme="light"] {
  --svg-card-green: #dafbe1;
  --svg-card-yellow: #fff8c5;
  --svg-card-red: #ffebe9;
  --svg-track: #eaeef2;
}
`.trim();

const THEME_STYLE_MARK = 'data-agx-svg-theme="1"';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHexColor(raw: string): string | null {
  const value = String(raw || "").trim().toLowerCase();
  if (
    !value ||
    value.startsWith("url(") ||
    value.startsWith("var(") ||
    value === "none" ||
    value === "currentcolor"
  ) {
    return null;
  }
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = short[1]!.split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  return null;
}

function mapColorToken(raw: string): string | null {
  const hex = normalizeHexColor(raw);
  if (!hex) return null;
  return COLOR_TO_THEME_VAR[hex] ?? null;
}

function rewriteColorAttributes(markup: string): string {
  let out = markup;
  // Longest hex first so we don't partially match oddly (not an issue for fixed #rrggbb).
  const entries = Object.entries(COLOR_TO_THEME_VAR).sort((a, b) => b[0].length - a[0].length);
  for (const [hex, cssVar] of entries) {
    const pattern = new RegExp(
      `((?:fill|stroke|stop-color|color)\\s*(?:=|:)\\s*["']?)${escapeRegExp(hex)}\\b`,
      "gi",
    );
    out = out.replace(pattern, `$1${cssVar}`);
  }
  return out;
}

function injectThemeStyle(markup: string): string {
  if (markup.includes(THEME_STYLE_MARK)) return markup;
  const styleTag = `<style ${THEME_STYLE_MARK}>${CARD_TINT_STYLE}</style>`;
  return markup.replace(/<svg\b[^>]*>/i, (open) => `${open}${styleTag}`);
}

/**
 * Rewrite hardcoded dark-theme hex colors in an SVG document to CSS variables
 * that resolve against the host Near theme. Idempotent for already-adapted markup.
 */
export function adaptSvgDocumentColors(doc: Document): boolean {
  const root = doc.documentElement;
  if (!root || root.querySelector("parsererror")) return false;

  let changed = false;
  doc.querySelectorAll("*").forEach((el) => {
    for (const name of ATTR_NAMES) {
      if (!el.hasAttribute(name)) continue;
      const mapped = mapColorToken(el.getAttribute(name) || "");
      if (!mapped) continue;
      el.setAttribute(name, mapped);
      changed = true;
    }
    const style = el.getAttribute("style");
    if (style) {
      const next = style.replace(
        /(fill|stroke|stop-color|color)\s*:\s*([^;]+)/gi,
        (full, prop: string, val: string) => {
          const mapped = mapColorToken(val.trim());
          if (!mapped) return full;
          changed = true;
          return `${prop}: ${mapped}`;
        },
      );
      if (next !== style) el.setAttribute("style", next);
    }
  });

  const already = root.querySelector('style[data-agx-svg-theme="1"]');
  if (!already) {
    const styleEl = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.setAttribute("data-agx-svg-theme", "1");
    styleEl.textContent = CARD_TINT_STYLE;
    root.insertBefore(styleEl, root.firstChild);
    changed = true;
  }

  return changed;
}

/** Markup-level helper (no DOM required — used by unit tests and PDF export). */
export function adaptSvgMarkupColors(svgMarkup: string): string {
  const source = String(svgMarkup ?? "");
  if (!source || !/<svg\b/i.test(source)) return source;
  return injectThemeStyle(rewriteColorAttributes(source));
}

/** Exported for unit tests. */
export const __adaptSvgThemeTest = {
  mapColorToken,
  COLOR_TO_THEME_VAR,
};

/**
 * Recolor leftover Notionists / geometric line-art to the current theme accent.
 * Near cube colorways and custom photo uploads stay untouched.
 * Author: Damon Li
 */

const GENERATED_INK_RE =
  /#000(?:000)?\b|#0a0a0a\b|#111(?:111)?\b|\bblack\b|#0891b2\b|#7c3aed\b|#e11d48\b|#d97706\b|#059669\b|#c026d3\b|#0284c7\b|#ea580c\b/gi;

function decodeSvgDataUrl(url: string): string | null {
  const raw = String(url || "").trim();
  if (!raw.startsWith("data:image/svg+xml")) return null;
  const comma = raw.indexOf(",");
  if (comma < 0) return null;
  const meta = raw.slice(0, comma);
  const payload = raw.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) return atob(payload);
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function looksLikeNearCubePortrait(svg: string): boolean {
  return /data-portrait=["']near-cube/i.test(svg);
}

export function isNearCubePortraitUrl(url: string): boolean {
  const value = String(url || "").trim();
  if (/(?:^|[\\/])near-cube-mark(?:-[^\\/]+)?\.svg(?:\?|#|$)/i.test(value)) return true;
  const svg = decodeSvgDataUrl(value);
  return Boolean(svg && looksLikeNearCubePortrait(svg));
}

function looksLikeGeneratedLineArt(svg: string): boolean {
  const text = svg.toLowerCase();
  if (!text.includes("<svg") || text.includes("<script") || text.includes("<image")) {
    return false;
  }
  if (looksLikeNearCubePortrait(svg) || svg.includes('data-portrait="identity-studio"')) {
    return false;
  }
  if (text.includes("viewbox=\"0 0 1744 1744\"") || text.includes("viewbox='0 0 1744 1744'")) {
    return true;
  }
  if (text.includes("viewbox=\"0 0 128 128\"") && text.includes('role="img"')) {
    return true;
  }
  return new RegExp(GENERATED_INK_RE.source, "i").test(svg);
}

export function lineArtSvgWithCurrentColor(svg: string): string {
  return svg.replace(GENERATED_INK_RE, "currentColor");
}

/** Inline SVG markup tinted via CSS `color`, or null when the src is a custom photo. */
export function prepareThemedPortraitMarkup(url: string): string | null {
  const svg = decodeSvgDataUrl(url);
  if (!svg || !looksLikeGeneratedLineArt(svg)) return null;
  return lineArtSvgWithCurrentColor(svg);
}

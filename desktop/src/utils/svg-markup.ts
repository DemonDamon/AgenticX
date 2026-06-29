/** Strip XML prolog before embedding SVG in HTML or data URLs (avoids UTF-8 mojibake in Chromium). */
export function prepareInlineSvgMarkup(raw: string): string {
  let s = String(raw ?? "").replace(/^\uFEFF/, "");
  s = s.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  s = s.replace(/^\s*<!DOCTYPE[^>]*>\s*/i, "");
  return s.trim();
}

/** SVG as img src with explicit UTF-8 charset (base64 data URLs often garble CJK text). */
export function buildSvgCharsetDataUrl(raw: string): string {
  const markup = prepareInlineSvgMarkup(raw);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

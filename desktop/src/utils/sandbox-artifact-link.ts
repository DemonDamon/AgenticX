/**
 * Parse sandbox:/abs or file:///abs links into a plain absolute filesystem path.
 *
 * Models sometimes emit Claude-style `sandbox:` artifact links that the desktop
 * cannot open; parsing them here lets the chat renderer open the real file or
 * flag the link as a likely hallucination when the file does not exist.
 */
export function parseLocalArtifactPath(url: string): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  let p = "";
  if (raw.startsWith("sandbox:")) {
    p = raw.slice("sandbox:".length);
    if (p.startsWith("//")) p = p.replace(/^\/+/, "/");
  } else if (/^file:\/\//i.test(raw)) {
    p = raw.replace(/^file:\/\//i, "");
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1); // file:///C:/... → C:/...
  } else {
    return null;
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    // Keep the raw path when percent-escapes are malformed.
  }
  p = p.trim();
  if (!p) return null;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)) return p;
  return null;
}

function decodeLocalPathSegment(segment: string): string {
  if (!segment || !/%[0-9A-Fa-f]{2}/.test(segment)) return segment;
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded === "." || decoded === "..") return segment;
    if (decoded.includes("/") || decoded.includes("\\")) return segment;
    return decoded;
  } catch {
    return segment;
  }
}

/**
 * Decode a markdown/URL-encoded local filesystem path exactly once.
 * Segments are decoded independently so `%20` / `%23` / CJK work, while
 * `%2F` and encoded `..` cannot invent extra separators or traversal.
 */
export function decodePercentEncodedLocalPath(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/assets/")) return value;
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;

  const filePrefix = value.match(/^file:\/\//i)?.[0] ?? "";
  const rest = filePrefix ? value.slice(filePrefix.length) : value;
  const sep = rest.includes("\\") && !rest.includes("/") ? "\\" : "/";
  return `${filePrefix}${rest.split(sep).map(decodeLocalPathSegment).join(sep)}`;
}

/**
 * Choose which local path to open: keep a literal `%xx` filename when it
 * exists on disk, otherwise use the decoded Chinese/space path.
 */
export function pickLocalFsPathCandidate(
  raw: string,
  exists: (path: string) => boolean,
): string {
  const original = String(raw ?? "").trim();
  if (!original) return "";
  const decoded = decodePercentEncodedLocalPath(original);
  if (decoded === original) return original;
  if (exists(original)) return original;
  return decoded;
}

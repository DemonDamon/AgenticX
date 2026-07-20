/**
 * Rewrite relative local assets in HTML so srcDoc previews can show images/CSS/JS.
 *
 * srcDoc iframes have no document base URL, so `<img src="chart.svg">` next to the
 * HTML file breaks unless rewritten to data URLs (Trae-style in-app HTML preview).
 *
 * Author: Damon Li
 */

import { buildSvgCharsetDataUrl } from "./svg-markup";
import { parentDirectory } from "./workspace-file-path";

const SKIP_URL_RE = /^(?:https?:|data:|blob:|file:|\/\/|#|mailto:|javascript:)/i;

/** Match src/href on common asset-bearing tags. */
const ASSET_ATTR_RE =
  /(<(?:img|source|video|audio|script|link)\b[^>]*?\b(?:src|href)=["'])([^"']+)(["'])/gi;

function joinDir(dir: string, rel: string): string {
  const base = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = String(rel || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== ".");
  const stack = base ? base.split("/").filter(Boolean) : [];
  // Keep leading empty for POSIX absolute roots rebuilt below.
  const isAbsUnix = base.startsWith("/");
  const isWin = /^[a-zA-Z]:/.test(base);
  for (const part of parts) {
    if (part === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (isWin) {
    return stack.join("/");
  }
  return isAbsUnix ? `/${stack.join("/")}` : stack.join("/");
}

function isRelativeLocalRef(ref: string): boolean {
  const value = String(ref || "").trim();
  if (!value || SKIP_URL_RE.test(value)) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("~/")) {
    // Absolute paths are still local — allow rewriting via IPC.
    return true;
  }
  return true;
}

function resolveAssetPath(htmlAbsolutePath: string, ref: string): string | null {
  const value = String(ref || "").trim();
  if (!value || SKIP_URL_RE.test(value)) return null;
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) {
    return value.replace(/\\/g, "/");
  }
  if (value.startsWith("~/")) {
    return value;
  }
  const dir = parentDirectory(htmlAbsolutePath);
  if (!dir) return null;
  return joinDir(dir, value);
}

async function loadAssetDataUrl(absPath: string): Promise<string | null> {
  const lower = absPath.toLowerCase();
  const desktop = window.agenticxDesktop;
  if (!desktop) return null;

  if (/\.(svg|png|jpe?g|gif|webp|bmp|ico)$/i.test(lower)) {
    const loadImage = desktop.loadLocalImageDataUrl;
    if (typeof loadImage === "function") {
      const res = await loadImage(absPath);
      if (res.ok && res.dataUrl) return res.dataUrl;
    }
    // SVG fallback via text read + charset data URL (CJK-safe).
    if (lower.endsWith(".svg") && typeof desktop.readLocalTextFile === "function") {
      const text = await desktop.readLocalTextFile(absPath);
      if (text.ok && typeof text.content === "string") {
        return buildSvgCharsetDataUrl(text.content);
      }
    }
    return null;
  }

  if (/\.(css|js|mjs|json|txt|md|html|htm)$/i.test(lower) && typeof desktop.readLocalTextFile === "function") {
    const text = await desktop.readLocalTextFile(absPath);
    if (!text.ok || typeof text.content !== "string") return null;
    const mime = lower.endsWith(".css")
      ? "text/css"
      : lower.endsWith(".js") || lower.endsWith(".mjs")
        ? "text/javascript"
        : lower.endsWith(".json")
          ? "application/json"
          : "text/plain";
    return `data:${mime};charset=utf-8,${encodeURIComponent(text.content)}`;
  }

  return null;
}

/**
 * Rewrite relative (and absolute local) asset URLs in HTML to data URLs for srcDoc.
 */
export async function prepareLocalHtmlSrcDoc(
  htmlAbsolutePath: string,
  htmlContent: string,
): Promise<string> {
  const htmlPath = String(htmlAbsolutePath || "").trim();
  const source = String(htmlContent ?? "");
  if (!htmlPath || !source) return source;

  const cache = new Map<string, string | null>();
  const replacements: Array<{ start: number; end: number; value: string }> = [];

  ASSET_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSET_ATTR_RE.exec(source)) !== null) {
    const prefix = match[1] ?? "";
    const ref = match[2] ?? "";
    const suffix = match[3] ?? "";
    if (!isRelativeLocalRef(ref)) continue;
    // Keep remote CDN scripts/styles (https already skipped by isRelativeLocalRef via SKIP).
    const abs = resolveAssetPath(htmlPath, ref);
    if (!abs) continue;

    let dataUrl = cache.get(abs);
    if (dataUrl === undefined) {
      try {
        dataUrl = await loadAssetDataUrl(abs);
      } catch {
        dataUrl = null;
      }
      cache.set(abs, dataUrl);
    }
    if (!dataUrl) continue;

    const full = match[0] ?? "";
    const start = match.index;
    replacements.push({
      start,
      end: start + full.length,
      value: `${prefix}${dataUrl}${suffix}`,
    });
  }

  if (replacements.length === 0) return source;

  // Apply from the end so indices stay valid.
  replacements.sort((a, b) => b.start - a.start);
  let out = source;
  for (const item of replacements) {
    out = `${out.slice(0, item.start)}${item.value}${out.slice(item.end)}`;
  }
  return out;
}

/** Read a local HTML file and return srcDoc with local assets inlined as data URLs. */
export async function loadPreparedHtmlSrcDoc(
  htmlAbsolutePath: string,
): Promise<{ ok: true; srcDoc: string } | { ok: false; error: string }> {
  const path = String(htmlAbsolutePath || "").trim();
  if (!path) return { ok: false, error: "empty path" };
  const read = window.agenticxDesktop?.readLocalTextFile;
  if (typeof read !== "function") {
    return { ok: false, error: "当前客户端不支持读取本地 HTML" };
  }
  try {
    const result = await read(path);
    if (!result.ok || typeof result.content !== "string") {
      return { ok: false, error: result.error || "读取 HTML 失败" };
    }
    const srcDoc = await prepareLocalHtmlSrcDoc(path, result.content);
    return { ok: true, srcDoc };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

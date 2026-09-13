import path from "node:path";

export const LOCAL_MEDIA_SCHEME = "agx-media";

export const LOCAL_VIDEO_EXTS = new Set([".mp4", ".m4v", ".mov", ".webm"]);

export const LOCAL_MEDIA_SCHEME_PRIVILEGES = [
  {
    scheme: LOCAL_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
] as const;

export function isAllowedVideoExtension(filePath: string): boolean {
  return LOCAL_VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

export function buildLocalMediaUrl(absolutePath: string): string {
  const url = new URL(`${LOCAL_MEDIA_SCHEME}://preview/`);
  url.searchParams.set("p", absolutePath);
  return url.href;
}

export function parseLocalMediaPath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${LOCAL_MEDIA_SCHEME}:`) return null;
    const raw = url.searchParams.get("p");
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function resolveAllowedLocalVideoFile(
  rawPath: string | null,
  deps: {
    normalizePath: (raw: string) => string;
    isFile: (absolutePath: string) => boolean;
  },
): string | null {
  if (!rawPath) return null;
  const normalized = deps.normalizePath(rawPath);
  if (!normalized || !isAllowedVideoExtension(normalized)) return null;
  if (!deps.isFile(normalized)) return null;
  return normalized;
}

export function localVideoMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

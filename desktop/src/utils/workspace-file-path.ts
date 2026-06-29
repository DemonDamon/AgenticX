import type { Taskspace } from "../store";
import { stripLineRangeFromAbsPath } from "./chat-file-mention";

function normalizePath(p: string): string {
  return String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/** Join taskspace root (absolute) with a relative path from the Studio API (POSIX segments). */
export function absoluteTaskspacePath(root: string, relPath: string): string {
  const r = String(root || "").trim().replace(/[/\\]+$/, "");
  if (!r) return "";
  const norm = String(relPath || ".").replace(/\\/g, "/");
  const parts = norm.split("/").filter((p) => p && p !== ".");
  if (parts.length === 0) return r;
  const isWin = /^[a-zA-Z]:/.test(r) || r.startsWith("\\\\");
  const sep = isWin ? "\\" : "/";
  return `${r}${sep}${parts.join(sep)}`;
}

/** Detect absolute local file paths suitable for workspace preview. */
export function isAbsoluteFilePath(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t) || /^file:\/\//i.test(t)) return false;
  if (t.startsWith("/")) {
    return /\/[^/]+\.[a-zA-Z0-9]{1,12}$/.test(t) || /^\/(?:Users|home|tmp|var|opt|private|Volumes)\//.test(t);
  }
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  if (t.startsWith("~/")) return true;
  return false;
}

export function relativePathFromRoot(root: string, absPath: string): string {
  const r = normalizePath(root);
  const a = normalizePath(absPath);
  if (!r || !a) return absPath;
  if (a === r) return ".";
  const prefix = `${r}/`;
  if (a.startsWith(prefix)) return a.slice(prefix.length);
  const parts = a.split("/");
  return parts[parts.length - 1] || a;
}

export function parentDirectory(absPath: string): string {
  const norm = stripLineRangeFromAbsPath(normalizePath(absPath));
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return norm;
  return norm.slice(0, idx);
}

/** Resolve markdown/image relative refs (e.g. `images/foo.svg`) against the hosting file path. */
export function resolveRelativeAssetPath(fileAbsolutePath: string, src: string): string {
  const value = String(src ?? "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(value)) return value;
  if (value.startsWith("/assets/")) return value;
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\\/g, "/");

  const baseDir = parentDirectory(fileAbsolutePath);
  if (!baseDir) return value;

  const isWin = /^[a-zA-Z]:/.test(baseDir);
  const sep = isWin ? "\\" : "/";
  const segments = value.replace(/\\/g, "/").split("/");
  const baseParts = baseDir.split(/[/\\]/).filter((p) => p.length > 0);
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (baseParts.length > 0) baseParts.pop();
      continue;
    }
    baseParts.push(segment);
  }
  if (isWin) {
    const driveMatch = baseParts[0]?.match(/^([a-zA-Z]:)$/);
    if (driveMatch) {
      const drive = driveMatch[1];
      const rest = baseParts.slice(1).join(sep);
      return rest ? `${drive}${sep}${rest}` : drive;
    }
    return baseParts.join(sep);
  }
  return `/${baseParts.join("/")}`;
}

/** Whether a path is an absolute local filesystem path (not a workspace-relative path). */
export function isAbsoluteLocalPath(pathValue: string): boolean {
  const value = String(pathValue || "").trim();
  if (!value) return false;
  if (value.startsWith("file://")) return true;
  return isAbsoluteFilePath(value);
}

/** Resolve markdown host file to an absolute path for relative asset lookup. */
export function resolveMarkdownHostPath(
  filePath: string,
  workspaceRoot?: string,
  relPathFallback?: string
): string {
  const raw = stripLineRangeFromAbsPath(String(filePath || "").trim());
  const rel = stripLineRangeFromAbsPath(String(relPathFallback || "").trim());
  if (!raw && !rel) return "";
  if (raw && isAbsoluteLocalPath(raw)) {
    return raw.startsWith("file://") ? raw : raw.replace(/\\/g, "/");
  }
  if (workspaceRoot) {
    const relForJoin = rel || raw;
    if (relForJoin) return absoluteTaskspacePath(workspaceRoot, relForJoin);
  }
  return raw;
}


export function findTaskspaceForAbsPath(
  taskspaces: Taskspace[],
  absPath: string
): { taskspaceId: string; relPath: string } | null {
  const norm = normalizePath(stripLineRangeFromAbsPath(absPath));
  if (!norm) return null;
  let best: { taskspaceId: string; relPath: string; rootLen: number } | null = null;
  for (const ts of taskspaces) {
    const root = normalizePath(ts.path || "");
    if (!root) continue;
    const prefix = `${root}/`;
    if (norm === root || !norm.startsWith(prefix)) continue;
    const relPath = norm.slice(prefix.length);
    if (!relPath || relPath.endsWith("/")) continue;
    if (!best || root.length > best.rootLen) {
      best = { taskspaceId: ts.id, relPath, rootLen: root.length };
    }
  }
  return best ? { taskspaceId: best.taskspaceId, relPath: best.relPath } : null;
}

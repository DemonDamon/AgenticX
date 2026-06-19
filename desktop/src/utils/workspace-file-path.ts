import type { Taskspace } from "../store";

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
  const norm = normalizePath(absPath);
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return norm;
  return norm.slice(0, idx);
}

export function findTaskspaceForAbsPath(
  taskspaces: Taskspace[],
  absPath: string
): { taskspaceId: string; relPath: string } | null {
  const norm = normalizePath(absPath);
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

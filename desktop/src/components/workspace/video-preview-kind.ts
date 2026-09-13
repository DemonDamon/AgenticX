const WORKSPACE_VIDEO_EXTS = [".mp4", ".m4v", ".mov", ".webm"] as const;

export function isWorkspaceVideoPath(filePath: string): boolean {
  const base = String(filePath || "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = base.slice(dot).toLowerCase();
  return (WORKSPACE_VIDEO_EXTS as readonly string[]).includes(ext);
}

export function workspaceVideoMime(filePath: string): string {
  const base = String(filePath || "").toLowerCase();
  if (base.endsWith(".webm")) return "video/webm";
  if (base.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

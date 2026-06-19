export const NEAR_WORKSPACE_DRAG_MIME = "application/x-near-workspace-entry";

export type NearWorkspaceDragEntry = {
  type: "file" | "dir";
  taskspaceId: string;
  relPath: string;
  label: string;
};

export function encodeNearWorkspaceDragEntry(entry: NearWorkspaceDragEntry): string {
  return JSON.stringify(entry);
}

export function decodeNearWorkspaceDragEntry(raw: string): NearWorkspaceDragEntry | null {
  try {
    const parsed = JSON.parse(raw) as NearWorkspaceDragEntry;
    if (!parsed?.taskspaceId || !parsed?.relPath || !parsed?.label) return null;
    if (parsed.type !== "file" && parsed.type !== "dir") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function nearWorkspaceDragMimePresent(types: readonly string[]): boolean {
  return types.includes(NEAR_WORKSPACE_DRAG_MIME);
}

export function composerAcceptsDragTypes(types: readonly string[]): boolean {
  return types.includes("Files") || nearWorkspaceDragMimePresent(types);
}

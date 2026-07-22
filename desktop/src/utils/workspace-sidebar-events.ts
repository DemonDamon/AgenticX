/** Events for workspace picks originating from the left-sidebar file-manage view. */

export const NEAR_WORKSPACE_PICK_FILE = "near:workspace-pick-file";
export const NEAR_WORKSPACE_PICK_DIR = "near:workspace-pick-dir";
/** Open Trae-style WorkPanel preview tab from left-sidebar file-manage. */
export const NEAR_WORKSPACE_OPEN_PREVIEW = "near:workspace-open-preview";
/** Fired after WorkPanel auto-attaches artifact parent dirs to session taskspaces. */
export const NEAR_ARTIFACT_TASKSPACES_SYNCED = "near:artifact-taskspaces-synced";

export type NearArtifactTaskspacesSyncedDetail = {
  sessionId: string;
  added: number;
};

export type NearWorkspacePickFileDetail = {
  paneId: string;
  taskspaceId: string;
  path: string;
};

export type NearWorkspacePickDirDetail = {
  paneId: string;
  taskspaceId: string;
  relPath: string;
  label: string;
};

export type NearWorkspaceOpenPreviewDetail = {
  paneId: string;
  absolutePath: string;
};

export function dispatchWorkspacePickFile(detail: NearWorkspacePickFileDetail): void {
  window.dispatchEvent(new CustomEvent(NEAR_WORKSPACE_PICK_FILE, { detail }));
}

export function dispatchWorkspacePickDir(detail: NearWorkspacePickDirDetail): void {
  window.dispatchEvent(new CustomEvent(NEAR_WORKSPACE_PICK_DIR, { detail }));
}

export function dispatchWorkspaceOpenPreview(detail: NearWorkspaceOpenPreviewDetail): void {
  window.dispatchEvent(new CustomEvent(NEAR_WORKSPACE_OPEN_PREVIEW, { detail }));
}

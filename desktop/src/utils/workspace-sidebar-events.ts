/** Events for workspace picks originating from the left-sidebar file-manage view. */

export const NEAR_WORKSPACE_PICK_FILE = "near:workspace-pick-file";
export const NEAR_WORKSPACE_PICK_DIR = "near:workspace-pick-dir";

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

export function dispatchWorkspacePickFile(detail: NearWorkspacePickFileDetail): void {
  window.dispatchEvent(new CustomEvent(NEAR_WORKSPACE_PICK_FILE, { detail }));
}

export function dispatchWorkspacePickDir(detail: NearWorkspacePickDirDetail): void {
  window.dispatchEvent(new CustomEvent(NEAR_WORKSPACE_PICK_DIR, { detail }));
}

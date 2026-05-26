export const GLOBAL_SEARCH_OPEN_EVENT = "near:open-global-search";
export const GLOBAL_SEARCH_CLOSE_EVENT = "near:close-global-search";

/** Custom events from GlobalSearchPanel → App / ChatPane (renderer-only). */
export const GLOBAL_SEARCH_ADD_TO_WORKSPACE = "near:global-search:add-to-workspace";
export const GLOBAL_SEARCH_REFERENCE_FILE = "near:global-search:reference-file";
export const GLOBAL_SEARCH_WORKSPACE_ADDED = "near:global-search:workspace-added";

export type GlobalSearchAddToWorkspaceDetail = {
  folderPath: string;
};

export type GlobalSearchReferenceFileDetail = {
  paneId: string;
  filePath: string;
  mode: "current" | "new";
};

export function openGlobalSearch(): void {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT));
}

export function closeGlobalSearch(): void {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_CLOSE_EVENT));
}

export function dispatchGlobalSearchAddToWorkspace(folderPath: string): void {
  window.dispatchEvent(
    new CustomEvent<GlobalSearchAddToWorkspaceDetail>(GLOBAL_SEARCH_ADD_TO_WORKSPACE, {
      detail: { folderPath },
    })
  );
}

export function dispatchGlobalSearchReferenceFile(
  paneId: string,
  filePath: string,
  mode: "current" | "new"
): void {
  window.dispatchEvent(
    new CustomEvent<GlobalSearchReferenceFileDetail>(GLOBAL_SEARCH_REFERENCE_FILE, {
      detail: { paneId, filePath, mode },
    })
  );
}

export const GLOBAL_SEARCH_OPEN_EVENT = "near:open-global-search";
export const GLOBAL_SEARCH_CLOSE_EVENT = "near:close-global-search";

export function openGlobalSearch(): void {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT));
}

export function closeGlobalSearch(): void {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_CLOSE_EVENT));
}

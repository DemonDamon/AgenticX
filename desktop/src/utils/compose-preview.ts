export const COMPOSE_PREVIEW_PANE_ID = "pane-compose-preview";

export function isComposePreviewPane(pane: { id?: string; composePreview?: boolean } | null | undefined): boolean {
  return Boolean(pane?.composePreview);
}

export function filterDurablePanes<T extends { composePreview?: boolean }>(panes: T[]): T[] {
  return panes.filter((pane) => !isComposePreviewPane(pane));
}

export function persistActivePaneId(
  activePaneId: string,
  panes: Array<{ id: string; composePreview?: boolean }>,
): string {
  const active = panes.find((pane) => pane.id === activePaneId);
  if (active && !isComposePreviewPane(active)) return activePaneId;
  return filterDurablePanes(panes)[0]?.id ?? activePaneId;
}

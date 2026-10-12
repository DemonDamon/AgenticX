import { useAppStore } from "../../store";

/**
 * Pane fields needed to send a scratch turn.
 * Select primitives only — a fresh object from the Zustand selector
 * infinite-loops useSyncExternalStore (Maximum update depth exceeded).
 */
export function useScratchPaneMeta(paneId: string) {
  const avatarId = useAppStore(
    (s) => s.panes.find((item) => item.id === paneId)?.avatarId ?? null,
  );
  const modelProvider = useAppStore(
    (s) => s.panes.find((item) => item.id === paneId)?.modelProvider ?? "",
  );
  const modelName = useAppStore(
    (s) => s.panes.find((item) => item.id === paneId)?.modelName ?? "",
  );
  return { avatarId, modelProvider, modelName };
}

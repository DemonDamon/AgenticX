import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { createContext, useContext } from "react";

/** Drag listeners from `useSortable`; only present when multiple panes (reorder enabled). */
const PaneSortableHandleContext = createContext<DraggableSyntheticListeners | undefined>(undefined);

export function PaneSortableHandleProvider({
  value,
  children,
}: {
  value: DraggableSyntheticListeners | undefined;
  children: React.ReactNode;
}) {
  return <PaneSortableHandleContext.Provider value={value}>{children}</PaneSortableHandleContext.Provider>;
}

export function usePaneSortableHandle(): DraggableSyntheticListeners | undefined {
  return useContext(PaneSortableHandleContext);
}

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import { PaneSortableHandleProvider } from "./pane-sortable-context";

type Props = {
  id: string;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
};

export function SortablePaneWrapper({ id, style, className = "", children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const combinedStyle: CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragClasses = isDragging
    ? "opacity-40 ring-2 ring-dashed ring-[rgba(255,255,255,0.22)] ring-inset"
    : "";

  return (
    <div
      ref={setNodeRef}
      style={combinedStyle}
      className={`${className} ${dragClasses}`.trim()}
      {...attributes}
    >
      <PaneSortableHandleProvider value={listeners}>{children}</PaneSortableHandleProvider>
    </div>
  );
}

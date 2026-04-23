import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore, type ChatPane as ChatPaneState } from "../store";
import { ChatPane } from "./ChatPane";
import { PaneDivider } from "./PaneDivider";
import { SortablePaneWrapper } from "./SortablePaneWrapper";

type Props = {
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
};

const COLUMNS = 2;
const MIN_PCT = 15;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function PaneDragOverlayPreview({ pane }: { pane: ChatPaneState }) {
  const sessionSnippet = pane.sessionId ? `${pane.sessionId.slice(0, 8)}…` : "-";
  return (
    <div
      className="flex min-h-[40px] min-w-[200px] max-w-md cursor-grabbing flex-col justify-center rounded-lg border border-border bg-surface-card/95 px-4 py-2 shadow-lg shadow-black/40 backdrop-blur-sm"
      style={{ width: "min(100%, 360px)" }}
    >
      <div className="truncate text-sm font-medium text-text-strong">{pane.avatarName}</div>
      <div className="truncate text-[10px] text-text-faint">session: {sessionSnippet}</div>
    </div>
  );
}

export function PaneManager({ onOpenConfirm }: Props) {
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const focusMode = useAppStore((s) => s.focusMode);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const reorderPanes = useAppStore((s) => s.reorderPanes);

  const paneCount = panes.length;
  const rows = Math.ceil(paneCount / COLUMNS);

  const [colSizes, setColSizes] = useState<number[][]>(() =>
    Array.from({ length: rows }, () => [50, 50])
  );
  const [rowSizes, setRowSizes] = useState<number[]>(() =>
    Array.from({ length: rows }, () => 100 / rows)
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const resetLayoutSizes = useCallback((count: number) => {
    const r = Math.ceil(count / COLUMNS);
    setColSizes(Array.from({ length: r }, () => [50, 50]));
    setRowSizes(Array.from({ length: r }, () => 100 / r));
  }, []);

  useEffect(() => {
    const newRows = Math.ceil(paneCount / COLUMNS);
    setColSizes((prev) =>
      Array.from({ length: newRows }, (_, i) => prev[i] ?? [50, 50])
    );
    setRowSizes((prev) => {
      const newEqual = 100 / newRows;
      // 行数变化时必须整行重算：从 1 行(100%) 增到 2 行时若沿用 prev[0]=100 会得到 [100,50]，合计 150%，
      // 多行布局底部会出现大块空白（第二行被挤出可视区域）。
      if (prev.length !== newRows) {
        return Array.from({ length: newRows }, () => newEqual);
      }
      return Array.from({ length: newRows }, (_, i) => prev[i] ?? newEqual);
    });
  }, [paneCount]);

  const handleColDrag = (rowIndex: number, delta: number) => {
    const width = containerRef.current?.clientWidth ?? 1;
    const deltaPct = (delta / width) * 100;
    setColSizes((prev) => {
      const next = prev.map((row) => [...row]);
      const left = next[rowIndex][0];
      const right = next[rowIndex][1];
      const newLeft = clamp(left + deltaPct, MIN_PCT, 100 - MIN_PCT);
      next[rowIndex][0] = newLeft;
      next[rowIndex][1] = clamp(left + right - newLeft, MIN_PCT, 100 - MIN_PCT);
      return next;
    });
  };

  const handleRowDrag = (topRowIndex: number, delta: number) => {
    const height = containerRef.current?.clientHeight ?? 1;
    const deltaPct = (delta / height) * 100;
    setRowSizes((prev) => {
      const next = [...prev];
      const top = next[topRowIndex];
      const bottom = next[topRowIndex + 1];
      const newTop = clamp(top + deltaPct, MIN_PCT, 100 - MIN_PCT);
      next[topRowIndex] = newTop;
      next[topRowIndex + 1] = clamp(top + bottom - newTop, MIN_PCT, 100 - MIN_PCT);
      return next;
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const clearDrag = () => setActiveDragId(null);

  const handleDragEnd = (event: DragEndEvent) => {
    clearDrag();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = panes.findIndex((p) => p.id === active.id);
    const toIndex = panes.findIndex((p) => p.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    reorderPanes(fromIndex, toIndex);
    resetLayoutSizes(paneCount);
  };

  const isMulti = paneCount >= 2;
  const paneIds = panes.map((p) => p.id);
  const activeDragPane = activeDragId ? panes.find((p) => p.id === activeDragId) : undefined;

  const layoutTwoOrFewer = (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 overflow-hidden">
      {panes.map((pane, index) => {
        const widthPct =
          paneCount === 1 ? 100 : colSizes[0]?.[index] ?? 100 / paneCount;
        const isLast = index === panes.length - 1;
        const isFocused = activePaneId === pane.id;
        const outerStyle = {
          width: `${widthPct}%`,
          minWidth: isMulti ? 320 : undefined,
        } as const;

        const inner = (
          <>
            <div
              className={`flex h-full min-w-0 flex-1 overflow-hidden ${
                isFocused && isMulti && !focusMode ? "bg-[rgba(255,255,255,0.015)]" : ""
              }`}
            >
              <ChatPane
                paneId={pane.id}
                focused={isFocused}
                onFocus={() => setActivePaneId(pane.id)}
                onOpenConfirm={onOpenConfirm}
              />
            </div>
            {!isLast && paneCount === 2 ? (
              <PaneDivider direction="horizontal" onDrag={(delta) => handleColDrag(0, delta)} />
            ) : null}
          </>
        );

        if (paneCount < 2) {
          return (
            <div
              key={pane.id}
              className="flex h-full min-w-0 overflow-hidden"
              style={outerStyle}
            >
              {inner}
            </div>
          );
        }

        return (
          <SortablePaneWrapper
            key={pane.id}
            id={pane.id}
            className="flex h-full min-w-0 overflow-hidden"
            style={outerStyle}
          >
            {inner}
          </SortablePaneWrapper>
        );
      })}
    </div>
  );

  const layoutMultiRow = (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {Array.from({ length: rows }, (_, rowIndex) => {
        const rowPanes = panes.slice(rowIndex * COLUMNS, rowIndex * COLUMNS + COLUMNS);
        const rowHeightPct = rowSizes[rowIndex] ?? 100 / rows;
        const isLastRow = rowIndex === rows - 1;

        return (
          <div
            key={rowIndex}
            className="flex min-h-0 min-w-0 flex-col"
            style={{ height: `${rowHeightPct}%` }}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              {rowPanes.map((pane, colIndex) => {
                const colPcts = colSizes[rowIndex] ?? [50, 50];
                const widthPct = colPcts[colIndex] ?? 50;
                const isLastCol = colIndex === rowPanes.length - 1;
                const isFocused = activePaneId === pane.id;

                const outerStyle = {
                  width: `${widthPct}%`,
                  minWidth: 240,
                } as const;

                return (
                  <SortablePaneWrapper
                    key={pane.id}
                    id={pane.id}
                    className="flex h-full min-w-0 overflow-hidden"
                    style={outerStyle}
                  >
                    <div
                      className={`flex h-full min-w-0 flex-1 overflow-hidden ${
                        isFocused && !focusMode ? "bg-[rgba(255,255,255,0.015)]" : ""
                      }`}
                    >
                      <ChatPane
                        paneId={pane.id}
                        focused={isFocused}
                        onFocus={() => setActivePaneId(pane.id)}
                        onOpenConfirm={onOpenConfirm}
                      />
                    </div>
                    {!isLastCol && rowPanes.length === 2 ? (
                      <PaneDivider
                        direction="horizontal"
                        onDrag={(delta) => handleColDrag(rowIndex, delta)}
                      />
                    ) : null}
                  </SortablePaneWrapper>
                );
              })}
            </div>

            {!isLastRow ? (
              <PaneDivider
                direction="vertical"
                onDrag={(delta) => handleRowDrag(rowIndex, delta)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );

  if (paneCount <= 2) {
    if (paneCount < 2) {
      return layoutTwoOrFewer;
    }
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDrag}
      >
        <SortableContext items={paneIds} strategy={rectSortingStrategy}>
          {layoutTwoOrFewer}
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.25,1,0.5,1)" }}>
          {activeDragPane ? <PaneDragOverlayPreview pane={activeDragPane} /> : null}
        </DragOverlay>
      </DndContext>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDrag}
    >
      <SortableContext items={paneIds} strategy={rectSortingStrategy}>
        {layoutMultiRow}
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.25,1,0.5,1)" }}>
        {activeDragPane ? <PaneDragOverlayPreview pane={activeDragPane} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

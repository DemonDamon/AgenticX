import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import { ChatPane } from "./ChatPane";
import { PaneDivider } from "./PaneDivider";

type Props = {
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
};

export function PaneManager({ onOpenConfirm }: Props) {
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const paneCount = panes.length;

  useEffect(() => {
    if (paneCount !== 2) return;
    const equal = 100 / paneCount;
    setSizes((prev) => {
      const next: Record<string, number> = {};
      for (const pane of panes) {
        next[pane.id] = prev[pane.id] ?? equal;
      }
      const total = Object.values(next).reduce((sum, value) => sum + value, 0);
      if (total > 0) {
        for (const key of Object.keys(next)) {
          next[key] = (next[key] / total) * 100;
        }
      }
      return next;
    });
  }, [panes, paneCount]);

  const orderedPaneIds = useMemo(() => panes.map((pane) => pane.id), [panes]);

  const handleDragDivider = (leftPaneId: string, rightPaneId: string, deltaX: number) => {
    const width = containerRef.current?.clientWidth ?? 1;
    const deltaPercent = (deltaX / width) * 100;
    setSizes((prev) => {
      const left = prev[leftPaneId] ?? 0;
      const right = prev[rightPaneId] ?? 0;
      const nextLeft = Math.max(15, Math.min(85, left + deltaPercent));
      const consumed = nextLeft - left;
      const nextRight = Math.max(15, right - consumed);
      const adjust = right - nextRight;
      return {
        ...prev,
        [leftPaneId]: left + adjust,
        [rightPaneId]: nextRight,
      };
    });
  };

  const isMulti = paneCount >= 2;

  if (paneCount <= 2) {
    return (
      <div ref={containerRef} className="flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        {panes.map((pane, index) => {
          const widthPercent =
            paneCount === 1 ? 100 : (sizes[pane.id] ?? 100 / Math.max(1, paneCount));
          const isLast = index === panes.length - 1;
          const rightPaneId = orderedPaneIds[index + 1];
          const isFocused = activePaneId === pane.id;
          return (
            <div key={pane.id} className="flex h-full min-w-0 overflow-hidden" style={{ width: `${widthPercent}%`, minWidth: isMulti ? 320 : undefined }}>
              <div className={`flex h-full min-w-0 flex-1 overflow-hidden ${isFocused && isMulti ? "bg-[rgba(255,255,255,0.015)]" : ""}`}>
                <ChatPane
                  paneId={pane.id}
                  focused={isFocused}
                  onFocus={() => setActivePaneId(pane.id)}
                  onOpenConfirm={onOpenConfirm}
                />
              </div>
              {!isLast && rightPaneId ? (
                <PaneDivider onDrag={(delta) => handleDragDivider(pane.id, rightPaneId, delta)} />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  const columns = 2;
  const rows = Math.ceil(paneCount / columns);
  const fitsInViewport = rows <= 2;

  return (
    <div
      ref={containerRef}
      className={`min-w-0 flex-1 ${
        fitsInViewport ? "h-full overflow-hidden" : "h-full overflow-y-auto"
      }`}
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: fitsInViewport
            ? `repeat(${rows}, minmax(0, 1fr))`
            : `repeat(${rows}, minmax(320px, 50vh))`,
        }}
      >
        {panes.map((pane, index) => {
          const isFocused = activePaneId === pane.id;
          const col = index % columns;
          const row = Math.floor(index / columns);
          const borderClasses = [
            col < columns - 1 ? "border-r" : "",
            row < rows - 1 ? "border-b" : "",
          ].filter(Boolean).join(" ");
          return (
            <div
              key={pane.id}
              className={`min-w-0 min-h-0 overflow-hidden border-[rgba(255,255,255,0.06)] ${borderClasses} ${isFocused ? "bg-[rgba(255,255,255,0.015)]" : ""}`}
            >
              <ChatPane
                paneId={pane.id}
                focused={isFocused}
                onFocus={() => setActivePaneId(pane.id)}
                onOpenConfirm={onOpenConfirm}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

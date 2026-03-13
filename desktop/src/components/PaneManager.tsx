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

  if (paneCount <= 2) {
    return (
      <div ref={containerRef} className="flex h-full min-w-0 flex-1 overflow-hidden bg-base px-2 py-2">
        {panes.map((pane, index) => {
          const widthPercent =
            paneCount === 1 ? 100 : (sizes[pane.id] ?? 100 / Math.max(1, paneCount));
          const isLast = index === panes.length - 1;
          const rightPaneId = orderedPaneIds[index + 1];
          return (
            <div key={pane.id} className="flex h-full min-w-0" style={{ width: `${widthPercent}%` }}>
              <ChatPane
                paneId={pane.id}
                focused={activePaneId === pane.id}
                onFocus={() => setActivePaneId(pane.id)}
                onOpenConfirm={onOpenConfirm}
              />
              {!isLast && rightPaneId ? (
                <PaneDivider onDrag={(delta) => handleDragDivider(pane.id, rightPaneId, delta)} />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  // 3+ panes: 2-column grid layout
  // <=4 panes fit in viewport (田字格); 5+ panes scroll vertically
  const columns = 2;
  const rows = Math.ceil(paneCount / columns);
  const fitsInViewport = rows <= 2;

  return (
    <div
      ref={containerRef}
      className={`min-w-0 flex-1 bg-base px-2 py-2 ${
        fitsInViewport ? "h-full overflow-hidden" : "h-full overflow-y-auto"
      }`}
    >
      <div
        className="grid w-full gap-2"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: fitsInViewport
            ? `repeat(${rows}, minmax(0, 1fr))`
            : `repeat(${rows}, minmax(320px, 50vh))`,
          height: fitsInViewport ? "100%" : undefined,
        }}
      >
        {panes.map((pane) => (
          <div key={pane.id} className="min-w-0 min-h-0 overflow-hidden">
            <ChatPane
              paneId={pane.id}
              focused={activePaneId === pane.id}
              onFocus={() => setActivePaneId(pane.id)}
              onOpenConfirm={onOpenConfirm}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

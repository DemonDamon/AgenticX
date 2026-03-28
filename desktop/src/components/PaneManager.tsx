import { useEffect, useRef, useState } from "react";
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

const COLUMNS = 2;
const MIN_PCT = 15;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function PaneManager({ onOpenConfirm }: Props) {
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);

  const paneCount = panes.length;
  const rows = Math.ceil(paneCount / COLUMNS);

  // colSizes[rowIndex] = [leftPct, rightPct] for each row
  const [colSizes, setColSizes] = useState<number[][]>(() =>
    Array.from({ length: rows }, () => [50, 50])
  );
  // rowSizes = [row0Pct, row1Pct, ...]
  const [rowSizes, setRowSizes] = useState<number[]>(() =>
    Array.from({ length: rows }, () => 100 / rows)
  );

  const containerRef = useRef<HTMLDivElement>(null);

  // Re-init sizes when pane count changes
  useEffect(() => {
    const newRows = Math.ceil(paneCount / COLUMNS);
    setColSizes((prev) =>
      Array.from({ length: newRows }, (_, i) => prev[i] ?? [50, 50])
    );
    setRowSizes((prev) => {
      const newEqual = 100 / newRows;
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

  const isMulti = paneCount >= 2;

  // Single-column layout for 1–2 panes (original behaviour)
  if (paneCount <= 2) {
    return (
      <div ref={containerRef} className="flex h-full min-w-0 flex-1 overflow-hidden">
        {panes.map((pane, index) => {
          const widthPct =
            paneCount === 1
              ? 100
              : colSizes[0]?.[index] ?? 100 / paneCount;
          const isLast = index === panes.length - 1;
          const isFocused = activePaneId === pane.id;
          return (
            <div
              key={pane.id}
              className="flex h-full min-w-0 overflow-hidden"
              style={{ width: `${widthPct}%`, minWidth: isMulti ? 320 : undefined }}
            >
              <div
                className={`flex h-full min-w-0 flex-1 overflow-hidden ${isFocused && isMulti ? "bg-[rgba(255,255,255,0.015)]" : ""}`}
              >
                <ChatPane
                  paneId={pane.id}
                  focused={isFocused}
                  onFocus={() => setActivePaneId(pane.id)}
                  onOpenConfirm={onOpenConfirm}
                />
              </div>
              {!isLast && paneCount === 2 ? (
                <PaneDivider
                  direction="horizontal"
                  onDrag={(delta) => handleColDrag(0, delta)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  // Multi-pane: flex column of rows, each row is a flex row of panes
  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {Array.from({ length: rows }, (_, rowIndex) => {
        const rowPanes = panes.slice(rowIndex * COLUMNS, rowIndex * COLUMNS + COLUMNS);
        const rowHeightPct = rowSizes[rowIndex] ?? 100 / rows;
        const isLastRow = rowIndex === rows - 1;

        return (
          <div key={rowIndex} className="flex min-h-0 min-w-0 flex-col" style={{ height: `${rowHeightPct}%` }}>
            {/* Row content */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              {rowPanes.map((pane, colIndex) => {
                const colPcts = colSizes[rowIndex] ?? [50, 50];
                const widthPct = colPcts[colIndex] ?? 50;
                const isLastCol = colIndex === rowPanes.length - 1;
                const isFocused = activePaneId === pane.id;

                return (
                  <div
                    key={pane.id}
                    className="flex h-full min-w-0 overflow-hidden"
                    style={{ width: `${widthPct}%`, minWidth: 240 }}
                  >
                    <div
                      className={`flex h-full min-w-0 flex-1 overflow-hidden ${isFocused ? "bg-[rgba(255,255,255,0.015)]" : ""}`}
                    >
                      <ChatPane
                        paneId={pane.id}
                        focused={isFocused}
                        onFocus={() => setActivePaneId(pane.id)}
                        onOpenConfirm={onOpenConfirm}
                      />
                    </div>
                    {/* Horizontal (column) divider between cols in same row */}
                    {!isLastCol && rowPanes.length === 2 ? (
                      <PaneDivider
                        direction="horizontal"
                        onDrag={(delta) => handleColDrag(rowIndex, delta)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Vertical (row) divider between rows */}
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
}

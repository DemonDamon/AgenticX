"use client";

import { useMemo } from "react";
import { cn } from "@agenticx/ui";

export type HeatmapCell = {
  dim: string;
  time: string;
  total_tokens: number;
  cost_usd: number;
};

type TokenHeatmapProps = {
  dimensions: string[];
  timeSlots: string[];
  cells: HeatmapCell[];
  metric: "total_tokens" | "cost_usd";
  loading?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  dimHeader: string;
};

function cellValue(cell: HeatmapCell, metric: "total_tokens" | "cost_usd"): number {
  return metric === "cost_usd" ? cell.cost_usd : cell.total_tokens;
}

function colorForRatio(ratio: number): string {
  if (ratio <= 0) return "rgb(var(--muted) / 0.35)";
  const alpha = 0.15 + ratio * 0.85;
  return `color-mix(in oklch, var(--primary) ${Math.round(alpha * 100)}%, transparent)`;
}

export function TokenHeatmap({
  dimensions,
  timeSlots,
  cells,
  metric,
  loading,
  emptyTitle,
  emptyDescription,
  dimHeader,
}: TokenHeatmapProps) {
  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    for (const cell of cells) {
      map.set(`${cell.dim}|${cell.time}`, cell);
    }
    return map;
  }, [cells]);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const cell of cells) {
      max = Math.max(max, cellValue(cell, metric));
    }
    return max;
  }, [cells, metric]);

  if (!loading && dimensions.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <div className="text-sm font-medium">{emptyTitle}</div>
        <div className="mt-1 text-xs text-muted-foreground">{emptyDescription}</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="bg-muted/40">
            <th className="sticky left-0 z-10 min-w-[120px] border-b border-border bg-muted/40 px-3 py-2 text-left font-semibold">
              {dimHeader}
            </th>
            {timeSlots.map((slot) => (
              <th key={slot} className="min-w-[72px] border-b border-border px-2 py-2 text-center font-mono font-normal text-muted-foreground">
                {slot.length > 10 ? slot.slice(5, 16) : slot}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dimensions.map((dim) => (
            <tr key={dim} className="border-b border-border last:border-0">
              <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">{dim}</td>
              {timeSlots.map((time) => {
                const cell = cellMap.get(`${dim}|${time}`);
                const value = cell ? cellValue(cell, metric) : 0;
                const ratio = maxValue > 0 ? value / maxValue : 0;
                return (
                  <td
                    key={`${dim}-${time}`}
                    className={cn("px-2 py-2 text-center font-mono tabular-nums")}
                    style={{ backgroundColor: colorForRatio(ratio) }}
                    title={
                      metric === "cost_usd"
                        ? `$${value.toFixed(6)} · ${cell?.total_tokens.toLocaleString() ?? 0} tokens`
                        : `${value.toLocaleString()} tokens · $${(cell?.cost_usd ?? 0).toFixed(6)}`
                    }
                  >
                    {metric === "cost_usd" ? (value > 0 ? `$${value.toFixed(2)}` : "—") : value > 0 ? value.toLocaleString() : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

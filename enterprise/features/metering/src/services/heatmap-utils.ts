import type { HeatmapCell, HeatmapQueryResult, HeatmapTimeGranularity } from "../types";

export type RawHeatmapRow = {
  dim: string;
  time: string;
  total_tokens: number;
  cost_usd: number;
};

export function formatTimeSlot(raw: unknown, granularity: HeatmapTimeGranularity): string {
  if (raw instanceof Date) {
    return granularity === "hour" ? raw.toISOString().slice(0, 13) + ":00:00.000Z" : raw.toISOString().slice(0, 10);
  }
  const text = String(raw ?? "");
  if (granularity === "day") {
    return text.slice(0, 10);
  }
  return text;
}

export function buildHeatmapMatrix(
  rows: RawHeatmapRow[],
  options: {
    limitDimensions?: number;
    timeGranularity: HeatmapTimeGranularity;
  }
): Pick<HeatmapQueryResult, "dimensions" | "time_slots" | "cells"> {
  const limitDimensions = options.limitDimensions ?? 30;
  if (rows.length === 0) {
    return { dimensions: [], time_slots: [], cells: [] };
  }

  const totalsByDim = new Map<string, number>();
  for (const row of rows) {
    totalsByDim.set(row.dim, (totalsByDim.get(row.dim) ?? 0) + row.total_tokens);
  }
  const dimensions = [...totalsByDim.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitDimensions)
    .map(([dim]) => dim);
  const dimSet = new Set(dimensions);

  const timeSet = new Set<string>();
  const cellMap = new Map<string, HeatmapCell>();
  for (const row of rows) {
    if (!dimSet.has(row.dim)) continue;
    const time = formatTimeSlot(row.time, options.timeGranularity);
    timeSet.add(time);
    const key = `${row.dim}|${time}`;
    const current = cellMap.get(key) ?? { dim: row.dim, time, total_tokens: 0, cost_usd: 0 };
    current.total_tokens += row.total_tokens;
    current.cost_usd += row.cost_usd;
    cellMap.set(key, current);
  }

  const time_slots = [...timeSet].sort();
  const cells = [...cellMap.values()].sort((a, b) => {
    const dimCmp = dimensions.indexOf(a.dim) - dimensions.indexOf(b.dim);
    if (dimCmp !== 0) return dimCmp;
    return a.time.localeCompare(b.time);
  });

  return { dimensions, time_slots, cells };
}

export function emptyHeatmapResult(): Pick<HeatmapQueryResult, "dimensions" | "time_slots" | "cells"> {
  return { dimensions: [], time_slots: [], cells: [] };
}

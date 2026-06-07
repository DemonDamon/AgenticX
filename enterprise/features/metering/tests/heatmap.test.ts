import { describe, expect, it } from "vitest";
import { buildHeatmapMatrix, emptyHeatmapResult, formatTimeSlot } from "../src/services/heatmap-utils";

describe("buildHeatmapMatrix", () => {
  it("returns empty matrix for no rows (AC-3)", () => {
    expect(buildHeatmapMatrix([], { timeGranularity: "day" })).toEqual(emptyHeatmapResult());
  });

  it("aggregates dimension x time cells and limits top dimensions (AC-1)", () => {
    const rows = [
      { dim: "dept-a", time: "2026-06-01", total_tokens: 100, cost_usd: 1 },
      { dim: "dept-a", time: "2026-06-02", total_tokens: 50, cost_usd: 0.5 },
      { dim: "dept-b", time: "2026-06-01", total_tokens: 200, cost_usd: 2 },
      { dim: "dept-c", time: "2026-06-01", total_tokens: 10, cost_usd: 0.1 },
    ];
    const result = buildHeatmapMatrix(rows, { limitDimensions: 2, timeGranularity: "day" });
    expect(result.dimensions).toEqual(["dept-b", "dept-a"]);
    expect(result.time_slots).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.cells).toHaveLength(3);
    const deptACell = result.cells.find((cell) => cell.dim === "dept-a" && cell.time === "2026-06-01");
    expect(deptACell?.total_tokens).toBe(100);
    expect(deptACell?.cost_usd).toBe(1);
  });

  it("merges duplicate dim/time keys", () => {
    const rows = [
      { dim: "m1", time: "2026-06-01", total_tokens: 10, cost_usd: 0.1 },
      { dim: "m1", time: "2026-06-01", total_tokens: 5, cost_usd: 0.2 },
    ];
    const result = buildHeatmapMatrix(rows, { timeGranularity: "day" });
    expect(result.cells[0]?.total_tokens).toBe(15);
    expect(result.cells[0]?.cost_usd).toBeCloseTo(0.3);
  });
});

describe("formatTimeSlot", () => {
  it("formats hour and day buckets", () => {
    const date = new Date("2026-06-05T14:30:00.000Z");
    expect(formatTimeSlot(date, "day")).toBe("2026-06-05");
    expect(formatTimeSlot(date, "hour")).toBe("2026-06-05T14:00:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { computeRoiRows, roiRowsToCsv } from "../src/services/roi-utils";

describe("computeRoiRows", () => {
  it("computes ROI as (revenue-cost)/cost and sorts descending (AC-2)", () => {
    const rows = computeRoiRows(
      [
        { label: "dept-a", cost_usd: 10 },
        { label: "dept-b", cost_usd: 20 },
      ],
      [
        { scenario_label: "dept-a", revenue_usd: 25 },
        { scenario_label: "dept-b", revenue_usd: 20 },
      ]
    );
    expect(rows[0]?.label).toBe("dept-a");
    expect(rows[0]?.roi).toBeCloseTo(1.5);
    expect(rows[1]?.label).toBe("dept-b");
    expect(rows[1]?.roi).toBeCloseTo(0);
    expect(rows[1]?.net_usd).toBe(0);
  });

  it("handles revenue-only and cost-only labels", () => {
    const rows = computeRoiRows([{ label: "x", cost_usd: 5 }], [{ scenario_label: "y", revenue_usd: 8 }]);
    expect(rows).toHaveLength(2);
    const revenueOnly = rows.find((row) => row.label === "y");
    expect(revenueOnly?.cost_usd).toBe(0);
    expect(revenueOnly?.roi).toBeNull();
  });

  it("returns empty array for no inputs (AC-3)", () => {
    expect(computeRoiRows([], [])).toEqual([]);
  });
});

describe("roiRowsToCsv", () => {
  it("exports header and rows", () => {
    const csv = roiRowsToCsv([
      { label: "a", cost_usd: 1, revenue_usd: 2, net_usd: 1, roi: 1 },
    ]);
    expect(csv.split("\n")[0]).toBe("label,cost_usd,revenue_usd,net_usd,roi");
    expect(csv).toContain("a,1.00000000,2.00000000,1.00000000,1.000000");
  });
});

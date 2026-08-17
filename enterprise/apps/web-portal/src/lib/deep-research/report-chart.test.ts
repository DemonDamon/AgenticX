import { describe, expect, it } from "vitest";
import {
  chartSpecToGfmTable,
  chartSpecToSvg,
  chartSpecToXyChart,
  parseChartSpec,
} from "./report-chart";

const BAR_JSON = JSON.stringify({
  type: "bar",
  title: "市场份额",
  x: ["A", "B", "C"],
  series: [{ name: "2026", data: [30, 45, 25] }],
});

describe("parseChartSpec", () => {
  it("parses a valid bar spec", () => {
    const spec = parseChartSpec(BAR_JSON);
    expect(spec?.type).toBe("bar");
    expect(spec?.x).toEqual(["A", "B", "C"]);
    expect(spec?.series[0]?.data).toEqual([30, 45, 25]);
  });

  it("rejects invalid shape, misaligned values, and hidden extra series", () => {
    expect(parseChartSpec("not-json")).toBeNull();
    expect(parseChartSpec('"str"')).toBeNull();
    expect(parseChartSpec(JSON.stringify({ type: "radar", x: ["a"], series: [{ data: [1] }] }))).toBeNull();
    expect(parseChartSpec(JSON.stringify({ type: "bar", x: [], series: [{ data: [] }] }))).toBeNull();
    expect(
      parseChartSpec(
        JSON.stringify({ type: "bar", x: ["a", "b"], series: [{ name: "s", data: [1] }] }),
      ),
    ).toBeNull();
    expect(
      parseChartSpec(
        JSON.stringify({ type: "bar", x: ["a", "b"], series: [{ name: "s", data: [1, "2"] }] }),
      ),
    ).toBeNull();
    expect(
      parseChartSpec(
        JSON.stringify({
          type: "scatter",
          x: ["a", "b"],
          series: [
            { name: "s1", data: [1, 2] },
            { name: "s2", data: [3, 4] },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("normalizes control characters and table delimiters in labels", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "pie",
        title: "占比\n图",
        x: ["甲|类", "乙"],
        series: [{ name: "s", data: [60, 40] }],
      }),
    );
    expect(spec?.title).toBe("占比 图");
    expect(spec?.x[0]).toBe("甲／类");
  });
});

describe("chart renderers", () => {
  it("renders bar data as xychart", () => {
    const chart = chartSpecToXyChart(parseChartSpec(BAR_JSON)!)!;
    expect(chart).toContain("xychart-beta");
    expect(chart).toContain('title "市场份额"');
    expect(chart).toContain('x-axis ["A", "B", "C"]');
    expect(chart).toContain("bar [30, 45, 25]");
  });

  it("renders pie data as escaped inline SVG", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "pie",
        title: "<占比>",
        x: ["甲", "乙"],
        series: [{ name: "s", data: [60, 40] }],
      }),
    )!;
    const svg = chartSpecToSvg(spec)!;
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
    expect(svg).toContain("60.0%");
    expect(svg).toContain("&lt;占比&gt;");
    expect(svg).not.toContain("<占比>");
  });

  it("falls back to a table without losing validated data", () => {
    const table = chartSpecToGfmTable(parseChartSpec(BAR_JSON)!);
    expect(table).toContain("| 指标 | A | B | C |");
    expect(table).toContain("| 2026 | 30 | 45 | 25 |");
  });
});

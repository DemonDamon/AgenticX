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
  it("解析合法 bar spec", () => {
    const spec = parseChartSpec(BAR_JSON);
    expect(spec?.type).toBe("bar");
    expect(spec?.x).toEqual(["A", "B", "C"]);
    expect(spec?.series[0]?.data).toEqual([30, 45, 25]);
  });

  it("拒绝：非 JSON / 非对象 / 未知类型 / x 为空 / series 与 x 不等长 / pie 多系列", () => {
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
        JSON.stringify({
          type: "pie",
          x: ["a", "b"],
          series: [
            { name: "s1", data: [1, 2] },
            { name: "s2", data: [3, 4] },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("chartSpecToXyChart", () => {
  it("bar → xychart-beta，含 title/x-axis/数据序列", () => {
    const spec = parseChartSpec(BAR_JSON)!;
    const xy = chartSpecToXyChart(spec)!;
    expect(xy).toContain("xychart-beta");
    expect(xy).toContain('title "市场份额"');
    expect(xy).toContain('x-axis ["A", "B", "C"]');
    expect(xy).toContain("bar [30, 45, 25]");
  });

  it("pie/scatter 不走 xychart", () => {
    const pie = parseChartSpec(
      JSON.stringify({ type: "pie", x: ["a", "b"], series: [{ data: [1, 2] }] }),
    )!;
    expect(chartSpecToXyChart(pie)).toBeNull();
  });
});

describe("chartSpecToSvg", () => {
  it("pie → 含 path 与图例的 SVG", () => {
    const pie = parseChartSpec(
      JSON.stringify({
        type: "pie",
        title: "占比",
        x: ["甲", "乙"],
        series: [{ name: "s", data: [60, 40] }],
      }),
    )!;
    const svg = chartSpecToSvg(pie)!;
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
    expect(svg).toContain("60.0%");
  });

  it("bar/line 不走 SVG 兜底", () => {
    const spec = parseChartSpec(BAR_JSON)!;
    expect(chartSpecToSvg(spec)).toBeNull();
  });
});

describe("chartSpecToGfmTable", () => {
  it("spec → GFM 表（数据不丢）", () => {
    const spec = parseChartSpec(BAR_JSON)!;
    const table = chartSpecToGfmTable(spec);
    expect(table).toContain("| 指标 | A | B | C |");
    expect(table).toContain("| 2026 | 30 | 45 | 25 |");
  });
});

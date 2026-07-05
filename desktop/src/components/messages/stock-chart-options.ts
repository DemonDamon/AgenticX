import type { StockChartPayload, StockChartSeriesPoint } from "./widget-preview";

export const STOCK_CHART_MAX_POINTS = 500;

function themeColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

export function downsampleStockPoints(
  points: StockChartSeriesPoint[],
  maxPoints = STOCK_CHART_MAX_POINTS,
): { points: StockChartSeriesPoint[]; truncated: boolean } {
  if (points.length <= maxPoints) return { points, truncated: false };
  return { points: points.slice(points.length - maxPoints), truncated: true };
}

export function buildStockChartOption(payload: StockChartPayload) {
  const { points, truncated } = downsampleStockPoints(payload.points);
  const dates = points.map((p) => p.date);
  const hasVolume = points.some((p) => typeof p.volume === "number" && p.volume > 0);

  const text = themeColor("--text-primary", "#e5e7eb");
  const muted = themeColor("--text-muted", "#9ca3af");
  const border = themeColor("--border-subtle", "#374151");
  const card = themeColor("--surface-card", "#111827");
  const up = themeColor("--status-error", "#ef4444");
  const down = themeColor("--status-success", "#22c55e");

  if (payload.chartType === "line") {
    return {
      backgroundColor: card,
      textStyle: { color: text },
      grid: { left: 48, right: 24, top: 24, bottom: hasVolume ? 72 : 48 },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: border, opacity: 0.35 } },
      },
      tooltip: { trigger: "axis" },
      dataZoom: truncated
        ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }]
        : points.length > 120
          ? [{ type: "inside" }]
          : undefined,
      series: [
        {
          type: "line",
          data: points.map((p) => p.close),
          smooth: true,
          lineStyle: { color: up, width: 2 },
          itemStyle: { color: up },
          areaStyle: { color: up, opacity: 0.08 },
        },
      ],
      _truncated: truncated,
    };
  }

  const grids = hasVolume
    ? [
        { left: 48, right: 24, top: 24, height: "58%" },
        { left: 48, right: 24, top: "72%", height: "16%" },
      ]
    : [{ left: 48, right: 24, top: 24, bottom: 48 }];

  const xAxes = hasVolume
    ? [
        {
          type: "category",
          data: dates,
          gridIndex: 0,
          axisLabel: { color: muted },
          axisLine: { lineStyle: { color: border } },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: border } },
        },
      ]
    : [
        {
          type: "category",
          data: dates,
          axisLabel: { color: muted },
          axisLine: { lineStyle: { color: border } },
        },
      ];

  const yAxes = hasVolume
    ? [
        {
          type: "value",
          scale: true,
          gridIndex: 0,
          axisLabel: { color: muted },
          splitLine: { lineStyle: { color: border, opacity: 0.35 } },
        },
        {
          type: "value",
          gridIndex: 1,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ]
    : [
        {
          type: "value",
          scale: true,
          axisLabel: { color: muted },
          splitLine: { lineStyle: { color: border, opacity: 0.35 } },
        },
      ];

  const series: Record<string, unknown>[] = [
    {
      type: "candlestick",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: points.map((p) => [p.open, p.close, p.low, p.high]),
      itemStyle: {
        color: up,
        color0: down,
        borderColor: up,
        borderColor0: down,
      },
    },
  ];

  if (hasVolume) {
    series.push({
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: points.map((p) => p.volume ?? 0),
      itemStyle: { color: muted, opacity: 0.55 },
    });
  }

  return {
    backgroundColor: card,
    textStyle: { color: text },
    axisPointer: hasVolume ? { link: [{ xAxisIndex: "all" }] } : undefined,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: { trigger: "axis" },
    dataZoom: truncated
      ? [{ type: "inside", xAxisIndex: hasVolume ? [0, 1] : [0] }, { type: "slider", height: 18, bottom: 8 }]
      : points.length > 120
        ? [{ type: "inside", xAxisIndex: hasVolume ? [0, 1] : [0] }]
        : undefined,
    series,
    _truncated: truncated,
  };
}

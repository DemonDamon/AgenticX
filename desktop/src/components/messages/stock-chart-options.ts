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
  const dates = points.map((p) => {
    const raw = String(p.date ?? "");
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(5);
    return raw;
  });
  const hasVolume = points.some((p) => typeof p.volume === "number" && p.volume > 0);

  const text = themeColor("--text-primary", "#e5e7eb");
  const muted = themeColor("--text-muted", "#9ca3af");
  const border = themeColor("--border-subtle", "#374151");
  const up = themeColor("--status-error", "#ef4444");
  const down = themeColor("--status-success", "#22c55e");

  const baseAxis = {
    axisLabel: { color: muted, fontSize: 11 },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: border, opacity: 0.22, type: "dashed" as const } },
  };

  if (payload.chartType === "line") {
    return {
      backgroundColor: "transparent",
      textStyle: { color: text },
      grid: { left: 52, right: 16, top: 16, bottom: hasVolume ? 68 : 36, containLabel: false },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        ...baseAxis,
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        ...baseAxis,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: themeColor("--surface-popover", "#1f2937"),
        borderColor: border,
        textStyle: { color: text, fontSize: 12 },
      },
      dataZoom: truncated
        ? [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: border }]
        : points.length > 120
          ? [{ type: "inside" }]
          : undefined,
      series: [
        {
          type: "line",
          data: points.map((p) => p.close),
          smooth: true,
          symbol: "none",
          lineStyle: { color: up, width: 2 },
          itemStyle: { color: up },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: up },
                { offset: 1, color: "rgba(0,0,0,0)" },
              ],
            },
            opacity: 0.12,
          },
        },
      ],
      _truncated: truncated,
    };
  }

  const grids = hasVolume
    ? [
        { left: 52, right: 16, top: 16, height: "56%" },
        { left: 52, right: 16, top: "74%", height: "14%" },
      ]
    : [{ left: 52, right: 16, top: 16, bottom: 36, containLabel: false }];

  const xAxes = hasVolume
    ? [
        {
          type: "category",
          data: dates,
          gridIndex: 0,
          boundaryGap: true,
          ...baseAxis,
          splitLine: { show: false },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
        },
      ]
    : [
        {
          type: "category",
          data: dates,
          boundaryGap: true,
          ...baseAxis,
          splitLine: { show: false },
        },
      ];

  const yAxes = hasVolume
    ? [
        {
          type: "value",
          scale: true,
          gridIndex: 0,
          ...baseAxis,
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
          ...baseAxis,
        },
      ];

  const series: Record<string, unknown>[] = [
    {
      type: "candlestick",
      xAxisIndex: 0,
      yAxisIndex: 0,
      barMaxWidth: 14,
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
      barMaxWidth: 8,
      data: points.map((p, idx) => ({
        value: p.volume ?? 0,
        itemStyle: {
          color: points[idx].close >= points[idx].open ? up : down,
          opacity: 0.45,
        },
      })),
    });
  }

  return {
    backgroundColor: "transparent",
    textStyle: { color: text },
    axisPointer: hasVolume
      ? { link: [{ xAxisIndex: "all" }], lineStyle: { color: muted, opacity: 0.35 } }
      : { lineStyle: { color: muted, opacity: 0.35 } },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: "axis",
      backgroundColor: themeColor("--surface-popover", "#1f2937"),
      borderColor: border,
      textStyle: { color: text, fontSize: 12 },
      axisPointer: { type: "cross" },
    },
    dataZoom: truncated
      ? [{ type: "inside", xAxisIndex: hasVolume ? [0, 1] : [0] }, { type: "slider", height: 16, bottom: 6, borderColor: border }]
      : points.length > 120
        ? [{ type: "inside", xAxisIndex: hasVolume ? [0, 1] : [0] }]
        : undefined,
    series,
    _truncated: truncated,
  };
}

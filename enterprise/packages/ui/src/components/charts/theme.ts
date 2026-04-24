/**
 * 图表主题共用常量
 *
 * 所有值都只返回 CSS var 引用，让图表颜色随 light/dark 自动切换。
 */

export const chartPalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
] as const;

export const chartColors = {
  grid: "var(--border)",
  axis: "var(--muted-foreground)",
  tooltipBg: "var(--popover)",
  tooltipBorder: "var(--border)",
  tooltipText: "var(--popover-foreground)",
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
};

import type * as React from "react";

export const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: chartColors.tooltipBg,
  border: `1px solid ${chartColors.tooltipBorder}`,
  borderRadius: 8,
  color: chartColors.tooltipText,
  fontSize: 12,
  padding: "8px 10px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

export const chartLabelStyle: React.CSSProperties = {
  color: chartColors.axis,
  fontSize: 11,
};

/**
 * recharts Tick 组件接受 SVG text 属性（不是 CSSProperties）。
 * 导出一个对象式的 tick props 专门用在 XAxis/YAxis 的 tick prop 上。
 */
export const chartAxisTickProps = {
  fill: chartColors.axis,
  fontSize: 11,
} as const;

export const chartLegendWrapperStyle: React.CSSProperties = {
  color: chartColors.axis,
  fontSize: 11,
};

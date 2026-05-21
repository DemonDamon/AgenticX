"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/cn";
import {
  chartAxisTickProps,
  chartLabelStyle,
  chartLegendWrapperStyle,
  chartPalette,
  chartTooltipStyle,
  chartColors,
} from "./theme";

/**
 * ChartCard · recharts 卡片高阶组件集合
 *
 * 提供三类卡：
 *   - LineCard / AreaCard / BarCard：多序列时间序列
 *   - DonutCard：占比图
 *   - SparkLine：最小化折线（KPI 卡内部用）
 *
 * 全部使用 @theme inline 注册的 CSS vars，暗色/亮色主题自动跟随。
 */

export interface ChartSeries {
  key: string;
  label?: string;
  color?: string;
}

export interface LineChartCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: ChartSeries[];
  variant?: "line" | "area";
  height?: number;
  className?: string;
  hideLegend?: boolean;
  emptyLabel?: string;
}

function renderTooltip() {
  return (
    <Tooltip
      contentStyle={chartTooltipStyle}
      labelStyle={{ ...chartLabelStyle, marginBottom: 4, fontWeight: 600, color: "var(--foreground)" }}
      itemStyle={chartLabelStyle}
      cursor={{ stroke: chartColors.grid, strokeWidth: 1, strokeDasharray: "4 4" }}
    />
  );
}

export function LineCard({
  title,
  description,
  actions,
  data,
  xKey,
  series,
  variant = "line",
  height = 260,
  className,
  hideLegend,
  emptyLabel = "暂无数据",
}: LineChartCardProps) {
  return (
    <ChartShell title={title} description={description} actions={actions} className={className}>
      <div style={{ height }}>
        {data.length === 0 ? (
          <ChartEmpty label={emptyLabel} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {variant === "area" ? (
              <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  {series.map((s, index) => {
                    const color = s.color ?? chartPalette[index % chartPalette.length];
                    return (
                      <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey={xKey} stroke={chartColors.axis} tick={chartAxisTickProps} axisLine={false} tickLine={false} />
                <YAxis stroke={chartColors.axis} tick={chartAxisTickProps} axisLine={false} tickLine={false} />
                {renderTooltip()}
                {!hideLegend ? <Legend iconType="circle" wrapperStyle={chartLegendWrapperStyle} /> : null}
                {series.map((s, index) => {
                  const color = s.color ?? chartPalette[index % chartPalette.length];
                  return (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label ?? s.key}
                      stroke={color}
                      strokeWidth={2}
                      fill={`url(#gradient-${s.key})`}
                      animationDuration={700}
                    />
                  );
                })}
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey={xKey} stroke={chartColors.axis} tick={chartAxisTickProps} axisLine={false} tickLine={false} />
                <YAxis stroke={chartColors.axis} tick={chartAxisTickProps} axisLine={false} tickLine={false} />
                {renderTooltip()}
                {!hideLegend ? <Legend iconType="circle" wrapperStyle={chartLegendWrapperStyle} /> : null}
                {series.map((s, index) => {
                  const color = s.color ?? chartPalette[index % chartPalette.length];
                  return (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label ?? s.key}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2 }}
                      animationDuration={700}
                    />
                  );
                })}
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </ChartShell>
  );
}

export interface BarChartCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: ChartSeries[];
  stacked?: boolean;
  height?: number;
  className?: string;
  hideLegend?: boolean;
  emptyLabel?: string;
}

export function BarCard({
  title,
  description,
  actions,
  data,
  xKey,
  series,
  stacked,
  height = 260,
  className,
  hideLegend,
  emptyLabel = "暂无数据",
}: BarChartCardProps) {
  return (
    <ChartShell title={title} description={description} actions={actions} className={className}>
      <div style={{ height }}>
        {data.length === 0 ? (
          <ChartEmpty label={emptyLabel} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey={xKey} stroke={chartColors.axis} tick={chartAxisTickProps} axisLine={false} tickLine={false} />
              <YAxis stroke={chartColors.axis} tick={chartAxisTickProps} axisLine={false} tickLine={false} />
              {renderTooltip()}
              {!hideLegend ? <Legend iconType="circle" wrapperStyle={chartLegendWrapperStyle} /> : null}
              {series.map((s, index) => {
                const color = s.color ?? chartPalette[index % chartPalette.length];
                return (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label ?? s.key}
                    stackId={stacked ? "stack" : undefined}
                    fill={color}
                    radius={[4, 4, 0, 0]}
                    animationDuration={700}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartShell>
  );
}

export interface DonutChartCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  data: Array<{ name: string; value: number; color?: string }>;
  height?: number;
  className?: string;
  centerLabel?: React.ReactNode;
  emptyLabel?: string;
}

export function DonutCard({
  title,
  description,
  actions,
  data,
  height = 260,
  className,
  centerLabel,
  emptyLabel = "暂无数据",
}: DonutChartCardProps) {
  return (
    <ChartShell title={title} description={description} actions={actions} className={className}>
      <div className="relative" style={{ height }}>
        {data.length === 0 ? (
          <ChartEmpty label={emptyLabel} />
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {renderTooltip()}
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="60%"
                  outerRadius="88%"
                  paddingAngle={2}
                  animationDuration={700}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={entry.color ?? chartPalette[index % chartPalette.length]}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Legend iconType="circle" wrapperStyle={chartLegendWrapperStyle} />
              </PieChart>
            </ResponsiveContainer>
            {centerLabel ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">{centerLabel}</div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </ChartShell>
  );
}

/* ============================================================
 * SparkLine · KPI 卡内嵌的极简折线
 * ============================================================ */
export interface SparkLineProps {
  data: Array<{ v: number }>;
  color?: string;
  height?: number | string;
  className?: string;
}

export function SparkLine({ data, color, height = 32, className }: SparkLineProps) {
  // 至少需要 2 个点才能画出面/折线，若只有 1 个点则简单复制一个使其变成平移的直线，避免单点显得怪异
  const validData = data.length === 1 ? [data[0], data[0]] : data;
  const gradientId = `spark-gradient-${React.useId().replace(/:/g, "")}`;

  if (validData.length === 0) {
    return null;
  }

  return (
    <div className={cn("pointer-events-none outline-none select-none", className)} style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={validData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color ?? chartPalette[0]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color ?? chartPalette[0]} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* 通过 YAxis 限制：当数据全为 0 时，保证 max 至少为 1，使 0 坐标贴在图表底部，防止全屏填充色块 */}
          <YAxis hide domain={[0, (dataMax: number) => Math.max(dataMax, 1)]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color ?? chartPalette[0]}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            animationDuration={500}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
 * 辅助：统一外壳 / 空态
 * ============================================================ */
function ChartShell({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <Card className={cn("overflow-hidden", className)}>
      {hasHeader ? (
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <div className="min-w-0 space-y-0.5">
            {title ? <CardTitle className="text-sm font-semibold">{title}</CardTitle> : null}
            {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(hasHeader ? "pt-0" : "pt-5")}>{children}</CardContent>
    </Card>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-1">
        <div className="h-8 w-8 rounded-full border border-dashed border-border" />
        <span>{label}</span>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * StatCard · 仪表盘 KPI 卡片
 *   包含 icon + 标签 + 大号数值 + 可选 delta 徽标 + 可选 sparkline 区域
 *
 * 设计要点：
 *   - 卡片背景用 bg-card（暗色自动切换）
 *   - icon 放在左上小圆章位置，使用 bg-primary-soft 浅色背景
 *   - delta 根据 trend 自动上色：up → success，down → danger，flat → muted
 *   - 底部 footer 区域可渲染 sparkline / footnote
 */
export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  delta?: {
    value: number | string;
    trend?: "up" | "down" | "flat";
    suffix?: string;
  };
  footer?: React.ReactNode;
  accentClassName?: string;
}

function renderTrendIcon(trend?: "up" | "down" | "flat") {
  if (trend === "up") return <ArrowUpRight className="h-3.5 w-3.5" />;
  if (trend === "down") return <ArrowDownRight className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

function trendColor(trend?: "up" | "down" | "flat"): string {
  if (trend === "up") return "bg-success-soft text-success";
  if (trend === "down") return "bg-danger-soft text-danger";
  return "bg-muted text-muted-foreground";
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  footer,
  accentClassName,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all",
        "hover:border-border-strong hover:shadow-md",
        className
      )}
      {...props}
    >
      {accentClassName ? (
        <div className={cn("pointer-events-none absolute inset-x-0 -top-px h-0.5", accentClassName)} />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-5">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none tracking-tight text-foreground">{value}</span>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
              trendColor(delta.trend)
            )}
          >
            {renderTrendIcon(delta.trend)}
            {delta.value}
            {delta.suffix ?? "%"}
          </span>
        ) : null}
      </div>
      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

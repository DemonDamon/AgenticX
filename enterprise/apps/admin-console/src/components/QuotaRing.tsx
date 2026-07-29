"use client";

import { cn } from "@agenticx/ui";

export function formatTokenCount(value: number): string {
  const safe = Math.max(0, Math.floor(Number(value) || 0));
  if (safe >= 100_000_000) return `${(safe / 100_000_000).toFixed(safe % 100_000_000 === 0 ? 0 : 1)} 亿`;
  if (safe >= 10_000) return `${(safe / 10_000).toFixed(safe % 10_000 === 0 ? 0 : 1)} 万`;
  return safe.toLocaleString("zh-CN");
}

export function QuotaRing({
  used,
  limit,
  unlimited = false,
  size = 136,
  className,
}: {
  used: number;
  limit: number;
  unlimited?: boolean;
  size?: number;
  className?: string;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const ratio = unlimited || limit <= 0 ? 0 : Math.min(Math.max(used / limit, 0), 1);
  const dash = circumference * ratio;
  const overLimit = !unlimited && limit > 0 && used >= limit;
  const nearingLimit = !unlimited && limit > 0 && ratio >= 0.8;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      aria-label={unlimited ? `已用 ${formatTokenCount(used)} Token，未设上限` : `已用 ${formatTokenCount(used)} / ${formatTokenCount(limit)} Token`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={overLimit ? "stroke-destructive" : nearingLimit ? "stroke-amber-500" : "stroke-primary"}
          style={{ strokeDasharray: `${dash} ${circumference}` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] text-muted-foreground">本月已用</span>
        <span className="mt-0.5 text-base font-semibold tracking-tight text-foreground">{formatTokenCount(used)}</span>
        <span className="mt-0.5 text-[10px] text-muted-foreground">
          {unlimited || limit <= 0 ? "未设上限" : `/ ${formatTokenCount(limit)}`}
        </span>
      </div>
    </div>
  );
}

import { Progress } from "@agenticx/ui";

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(value);
}

export type UsageSnapshot = {
  used: number;
  limit: number;
  remaining: number | null;
  unlimited: boolean;
  shared?: boolean;
};

export function QuotaUsageBar({
  usage,
  loading,
}: {
  usage?: UsageSnapshot | null;
  loading?: boolean;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">用量加载中…</p>;
  }
  if (!usage) {
    return <p className="text-xs text-muted-foreground">池用量：—</p>;
  }
  if (usage.unlimited) {
    return <p className="text-xs text-muted-foreground">不限额</p>;
  }
  const pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>
          {formatTokens(usage.used)}/{formatTokens(usage.limit)}
          {usage.shared ? " · 共享池" : ""}
        </span>
        <span>余 {formatTokens(usage.remaining ?? 0)}</span>
      </div>
      <Progress value={pct} className="h-1" />
    </div>
  );
}

"use client";

import * as React from "react";

type RemainingSlice = {
  used: number;
  limit: number;
  remaining: number | null;
  period: string;
  unlimited?: boolean;
  shared?: boolean;
};

type QuotaSummary = {
  daily?: RemainingSlice & { scope?: string; scopeId?: string; unlimited: boolean };
  weekly?: RemainingSlice & { scope?: string; scopeId?: string; unlimited: boolean };
  monthly?: RemainingSlice & { scope?: string; scopeId?: string; unlimited: boolean };
  user: RemainingSlice & { scope?: string; scopeId?: string; unlimited: boolean };
  dept: (RemainingSlice & { shared?: boolean; unlimited: boolean }) | null;
  unlimited: boolean;
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(value);
}

function UsageRow({
  label,
  slice,
}: {
  label: string;
  slice: RemainingSlice & { unlimited: boolean; shared?: boolean };
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium text-foreground">已用 {formatTokens(slice.used)} Token</span>
    </div>
  );
}

export function QuotaCard({ collapsed }: { collapsed?: boolean }) {
  const [summary, setSummary] = React.useState<QuotaSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/workspace/quota/summary", { cache: "no-store" });
        const json = (await res.json()) as { code?: string; message?: string; data?: QuotaSummary };
        if (!res.ok) {
          throw new Error(json.message ?? "load failed");
        }
        if (!cancelled) setSummary(json.data ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "load failed");
          setSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (collapsed) return null;

  if (loading) {
    return (
      <div className="mx-3 mb-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        用量加载中…
      </div>
    );
  }

  if (error || !summary) {
    return null;
  }

  const usageWindows = [
    { label: "今日", slice: summary.daily },
    { label: "本周", slice: summary.weekly },
    { label: "本月", slice: summary.monthly ?? summary.user },
  ].filter((item): item is { label: string; slice: RemainingSlice & { unlimited: boolean; shared?: boolean } } => Boolean(item.slice));

  return (
    <div className="mx-3 mb-2 space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
      <div className="text-xs font-medium text-foreground">Token 使用</div>
      {usageWindows.map((item) => <UsageRow key={item.label} label={item.label} slice={item.slice} />)}
    </div>
  );
}

export function QuotaUsageBar({
  used,
  compact,
}: {
  used: number;
  limit: number;
  remaining: number | null;
  unlimited: boolean;
  shared?: boolean;
  compact?: boolean;
}) {
  return <span className={compact ? "text-[11px] text-muted-foreground" : "text-xs text-muted-foreground"}>已用 {formatTokens(used)} Token</span>;
}

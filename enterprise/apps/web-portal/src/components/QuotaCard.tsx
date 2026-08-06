"use client";

import * as React from "react";
import { QUOTA_USAGE_CHANGED_EVENT } from "@agenticx/sdk-ts";

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
  const inFlightRef = React.useRef(false);
  const mountedRef = React.useRef(false);

  const refresh = React.useCallback(async (initial = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (initial && mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch("/api/workspace/quota/summary", { cache: "no-store" });
      const json = (await res.json()) as { code?: string; message?: string; data?: QuotaSummary };
      if (!res.ok) {
        throw new Error(json.message ?? "load failed");
      }
      if (mountedRef.current) setSummary(json.data ?? null);
    } catch (err) {
      // Keep the last good card during background refreshes. A transient quota
      // API failure should not make the sidebar disappear or require a reload.
      if (initial && mountedRef.current) {
        setError(err instanceof Error ? err.message : "load failed");
        setSummary(null);
      }
    } finally {
      inFlightRef.current = false;
      if (initial && mountedRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (collapsed) return;
    mountedRef.current = true;
    void refresh(true);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 5_000);
    window.addEventListener(QUOTA_USAGE_CHANGED_EVENT, refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
      window.removeEventListener(QUOTA_USAGE_CHANGED_EVENT, refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [collapsed, refresh]);

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

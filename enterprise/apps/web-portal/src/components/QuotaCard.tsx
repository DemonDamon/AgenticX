"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Progress } from "@agenticx/ui";

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

function unlimitedPlaceholder(): RemainingSlice & { unlimited: true } {
  return { used: 0, limit: 0, remaining: null, period: "", unlimited: true };
}

export function quotaResetHintKey(
  period: string,
): "quotaResetNextDay" | "quotaResetNextWeek" | "quotaResetNextMonth" | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return "quotaResetNextDay";
  if (/^\d{4}-W\d{2}$/.test(period)) return "quotaResetNextWeek";
  if (/^\d{4}-\d{2}$/.test(period)) return "quotaResetNextMonth";
  return null;
}

function UsageRow({
  label,
  slice,
}: {
  label: string;
  slice: RemainingSlice & { unlimited: boolean; shared?: boolean };
}) {
  const t = useTranslations("workspace");
  if (slice.unlimited) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-foreground">{t("quotaUnlimited")}</span>
        </div>
      </div>
    );
  }
  const pct = slice.limit > 0 ? Math.min(100, Math.round((slice.used / slice.limit) * 100)) : 0;
  const resetKey = quotaResetHintKey(slice.period);
  const reset = resetKey ? t(resetKey) : slice.period;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {label}
          {slice.shared ? t("quotaSharedPool") : ""}
        </span>
        <span className="tabular-nums text-foreground">
          {formatTokens(slice.used)} / {formatTokens(slice.limit)}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {t("quotaRemaining", { amount: formatTokens(slice.remaining ?? 0), reset })}
      </div>
    </div>
  );
}

export function QuotaCard({ collapsed }: { collapsed?: boolean }) {
  const t = useTranslations("workspace");
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
        {t("quotaLoading")}
      </div>
    );
  }

  if (error || !summary) {
    return null;
  }

  const daily = summary.daily ?? summary.user;
  const weekly = summary.weekly ?? unlimitedPlaceholder();
  const monthly = summary.monthly ?? summary.user;
  const allWindowUnlimited = daily.unlimited && weekly.unlimited && monthly.unlimited;

  if (allWindowUnlimited && !summary.dept) {
    return (
      <div className="mx-3 mb-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t("quotaTokenUnlimited")}
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 space-y-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
      <div className="text-xs font-medium text-foreground">{t("quotaTitle")}</div>
      {!allWindowUnlimited ? (
        <>
          <UsageRow label={t("quotaToday")} slice={daily} />
          <UsageRow label={t("quotaWeek")} slice={weekly} />
          <UsageRow label={t("quotaMonth")} slice={monthly} />
        </>
      ) : (
        <div className="text-xs text-muted-foreground">{t("quotaWindowsUnlimited")}</div>
      )}
      {summary.dept ? <UsageRow label={t("quotaDept")} slice={summary.dept} /> : null}
    </div>
  );
}

export function QuotaUsageBar({
  used,
  limit,
  remaining,
  unlimited,
  shared,
  compact,
}: {
  used: number;
  limit: number;
  remaining: number | null;
  unlimited: boolean;
  shared?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("workspace");
  if (unlimited) {
    return <span className="text-xs text-muted-foreground">{t("quotaUnlimited")}</span>;
  }
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5 min-w-[140px]"}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>
          {formatTokens(used)}/{formatTokens(limit)}
          {shared ? t("quotaPoolShort") : ""}
        </span>
        <span>{t("quotaLeftShort", { amount: formatTokens(remaining ?? 0) })}</span>
      </div>
      <Progress value={pct} className="h-1" />
    </div>
  );
}

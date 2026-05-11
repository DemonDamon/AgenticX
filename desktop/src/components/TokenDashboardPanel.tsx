import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useAppStore, type ThemeMode, type TokenDashboardRange } from "../store";
import {
  fetchUsageBreakdown,
  fetchUsageDaily,
  fetchUsageHeatmap,
  fetchUsageMeta,
  fetchUsageSummary,
  fetchUsageTopModels,
  type UsageBreakdownItem,
  type UsageDailyRow,
  type UsageSummary,
  type UsageTopModel,
} from "../services/usageApi";

const RANGE_LABELS: { id: TokenDashboardRange; label: string }[] = [
  { id: "day", label: "DAY" },
  { id: "week", label: "WEEK" },
  { id: "month", label: "MONTH" },
  { id: "total", label: "TOTAL" },
  { id: "custom", label: "CUSTOM" },
];

const PROVIDER_BAR_COLORS = ["#7c3aed", "#0891b2", "#10b981", "#eab308", "#f97316", "#ec4899", "#6366f1"];

function fmtCompact(n: number): string {
  const x = Math.max(0, Number(n) || 0);
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return String(Math.round(x));
}

function fmtUsd(n: number): string {
  const x = Number(n) || 0;
  return x.toFixed(2);
}

/** Lighter theme keeps green ramps; dark / dim use high-contrast white ramps. */
function heatmapBarFill(theme: ThemeMode, lvl: number): string {
  if (theme === "light") {
    if (lvl === 0) return "color-mix(in_oklab, var(--text-muted) 32%, var(--surface-base))";
    if (lvl === 1) return "#14532d";
    if (lvl === 2) return "#166534";
    if (lvl === 3) return "#22c55e";
    return "#4ade80";
  }
  if (lvl === 0) return "rgba(255, 255, 255, 0.12)";
  if (lvl === 1) return "rgba(255, 255, 255, 0.28)";
  if (lvl === 2) return "rgba(255, 255, 255, 0.46)";
  if (lvl === 3) return "rgba(255, 255, 255, 0.68)";
  return "rgba(255, 255, 255, 0.95)";
}

function datesAscending(fromIso: string, days: number): string[] {
  const out: string[] = [];
  try {
    const base = new Date(`${fromIso}T00:00:00.000Z`);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth();
    const da = base.getUTCDate();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.UTC(y, mo, da + i));
      out.push(d.toISOString().slice(0, 10));
    }
  } catch {
    // ignore
  }
  return out;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function TokenDashboardPanel({ open, onClose }: Props) {
  const theme = useAppStore((s) => s.theme);
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const range = useAppStore((s) => s.tokenDashboard.range);
  const customFrom = useAppStore((s) => s.tokenDashboard.customFrom);
  const customTo = useAppStore((s) => s.tokenDashboard.customTo);
  const setTokenDashboardRange = useAppStore((s) => s.setTokenDashboardRange);
  const setTokenDashboardCustomRange = useAppStore((s) => s.setTokenDashboardCustomRange);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [weekChip, setWeekChip] = useState<UsageSummary | null>(null);
  const [monthChip, setMonthChip] = useState<UsageSummary | null>(null);
  const [breakdown, setBreakdown] = useState<UsageBreakdownItem[]>([]);
  const [daily, setDaily] = useState<UsageDailyRow[]>([]);
  const [topModels, setTopModels] = useState<UsageTopModel[]>([]);
  const [heatmap, setHeatmap] = useState<{ date: string; total: number }[]>([]);
  const [meta, setMeta] = useState<{ started_at: number | null; active_days_30d: number; month_conversations: number } | null>(
    null,
  );

  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const customParams = useMemo(() => {
    if (range !== "custom") return undefined;
    return { from: customFrom.trim(), to: customTo.trim() };
  }, [range, customFrom, customTo]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    async function load() {
      setBusy(true);
      setErr(null);
      try {
        const base = await resolveApiBase();
        const tok = apiToken ?? "";
        if (range === "custom" && (!customParams?.from || !customParams?.to)) {
          setErr("请选择自定义区间的开始与结束日期");
          setBusy(false);
          return;
        }

        const [
          s,
          prov,
          dRows,
          tm,
          hm,
          m,
          wChip,
          mChip,
        ] = await Promise.all([
          fetchUsageSummary(base, tok, range, customParams),
          fetchUsageBreakdown(base, tok, range, "provider", customParams),
          fetchUsageDaily(base, tok, range, customParams),
          fetchUsageTopModels(base, tok, range, 3, customParams),
          fetchUsageHeatmap(base, tok, "total"),
          fetchUsageMeta(base, tok),
          fetchUsageSummary(base, tok, "week"),
          fetchUsageSummary(base, tok, "month"),
        ]);

        if (cancelled) return;
        setSummary(s);
        setBreakdown(prov.items ?? []);
        setDaily(dRows.items ?? []);
        setTopModels(tm.items ?? []);
        setHeatmap(hm.items ?? []);
        setMeta(m);
        setWeekChip(wChip);
        setMonthChip(mChip);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, range, customParams?.from, customParams?.to, apiToken, resolveApiBase]);

  const heatmapCells = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of heatmap) {
      map.set(row.date, row.total);
    }
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 371);
    const labels = datesAscending(start.toISOString().slice(0, 10), 372);
    let maxT = 1;
    const totals = labels.map((d) => {
      const v = map.get(d) ?? 0;
      maxT = Math.max(maxT, v);
      return v;
    });
    return { labels, totals, maxT };
  }, [heatmap]);

  const trendBars = useMemo(() => {
    const rows = [...daily];
    const tail = rows.slice(-30);
    const maxT = Math.max(1, ...tail.map((r) => r.total));
    return tail.map((r) => ({
      date: r.date,
      total: r.total,
      h: Math.round((r.total / maxT) * 48),
    }));
  }, [daily]);

  const avgDaily30 = monthChip ? monthChip.tokens / 30 : 0;

  const dailyDesc = useMemo(() => [...daily].reverse(), [daily]);

  if (!open) return null;

  const startedLabel =
    meta?.started_at != null ? new Date(meta.started_at).toLocaleDateString() : "—";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/88 px-3 py-6 backdrop-blur-md">
      <div
        className="relative flex max-h-[85vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agx-token-dash-title"
      >
        <div className="flex items-center justify-between border-b border-border bg-surface-base px-5 py-4">
          <h2 id="agx-token-dash-title" className="text-lg font-semibold tracking-tight text-[var(--text-strong)]">
            Token 消耗看板
          </h2>
          <button
            type="button"
            className="agx-topbar-btn !h-10 !w-10"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden bg-surface-base p-5 md:flex-row md:gap-5">
          <aside className="flex w-full shrink-0 flex-col gap-4 md:w-[340px] md:overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-surface-card px-3 py-2.5">
                <div className="text-xs uppercase tracking-wide text-[var(--text-primary)]">7d</div>
                <div className="truncate text-base font-semibold tabular-nums text-[var(--text-strong)]">
                  {fmtCompact(weekChip?.tokens ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface-card px-3 py-2.5">
                <div className="text-xs uppercase tracking-wide text-[var(--text-primary)]">30d</div>
                <div className="truncate text-base font-semibold tabular-nums text-[var(--text-strong)]">
                  {fmtCompact(monthChip?.tokens ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface-card px-3 py-2.5">
                <div className="text-xs uppercase tracking-wide text-[var(--text-primary)]">日均(估)</div>
                <div className="truncate text-base font-semibold tabular-nums text-[var(--text-strong)]">
                  {fmtCompact(avgDaily30)}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface-card px-3 py-2.5">
                <div className="text-xs uppercase tracking-wide text-[var(--text-primary)]">本月会话</div>
                <div className="truncate text-base font-semibold tabular-nums text-[var(--text-strong)]">
                  {fmtCompact(meta?.month_conversations ?? 0)}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface-card p-3">
              <div className="mb-1 text-sm font-medium text-[var(--text-strong)]">统计起始</div>
              <div className="text-base tabular-nums text-[var(--text-strong)]">{startedLabel}</div>
              <div className="mt-2 text-sm font-medium text-[var(--text-primary)]">
                近30日活跃天：{meta?.active_days_30d ?? 0}
              </div>
              <div className="mt-3 text-sm leading-relaxed text-[var(--text-primary)]">
                {/* Pricing overrides: ~/.agenticx/config.yaml → pricing.models */}
                金额为基于内置单价表的估算；可通过配置文件覆盖模型单价。
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface-card p-3">
              <div className="mb-2 text-sm font-medium text-[var(--text-strong)]">常用模型 Top 3</div>
              <ol className="space-y-2 text-sm">
                {(topModels.length ? topModels : []).map((m, i) => (
                  <li key={m.model} className="flex justify-between gap-2 text-[var(--text-strong)]">
                    <span className="truncate">
                      {i + 1}. {m.model || "(unknown)"}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--text-primary)]">{m.percent.toFixed(1)}%</span>
                  </li>
                ))}
                {!topModels.length ? <li className="font-medium text-[var(--text-primary)]">暂无数据</li> : null}
              </ol>
            </div>

            <div className="rounded-lg border border-border bg-surface-card p-3">
              <div className="mb-2 text-sm font-medium text-[var(--text-strong)]">活动热力（约一年）</div>
              <div className="overflow-x-auto rounded-md bg-surface-base px-1 py-1">
                <svg width={heatmapCells.labels.length * 5} height={32} className="block max-w-full">
                  {heatmapCells.labels.map((dayLabel, i) => {
                    const t = heatmapCells.totals[i] ?? 0;
                    const lvl =
                      t <= 0 ? 0 : t < heatmapCells.maxT * 0.25 ? 1 : t < heatmapCells.maxT * 0.5 ? 2 : t < heatmapCells.maxT * 0.75 ? 3 : 4;
                    const fill = heatmapBarFill(theme, lvl);
                    return <rect key={dayLabel} x={i * 5} y={5} width={4} height={20} fill={fill} rx={1} />;
                  })}
                </svg>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface-card p-3">
              <div className="mb-2 text-sm font-medium text-[var(--text-strong)]">趋势（当前区间 · 最多30日）</div>
              <div className="flex h-16 items-end gap-0.5 overflow-x-auto rounded-md bg-surface-base px-2 py-2">
                {trendBars.map((r) => (
                  <div
                    key={r.date}
                    title={`${r.date}: ${r.total}`}
                    className="w-2 shrink-0 rounded-sm bg-[color-mix(in_oklab,var(--accent,#6366f1)_82%,var(--surface-base))]"
                    style={{ height: `${Math.max(4, r.h)}px` }}
                  />
                ))}
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex flex-wrap gap-2">
              {RANGE_LABELS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`agx-topbar-btn !h-9 px-3 text-sm ${range === tab.id ? "agx-topbar-btn--active" : ""}`}
                  onClick={() => setTokenDashboardRange(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {range === "custom" ? (
              <div className="flex flex-wrap items-center gap-3 text-sm font-medium text-[var(--text-primary)]">
                <label className="flex items-center gap-2">
                  从
                  <input
                    type="date"
                    className="rounded-md border border-border bg-surface-card px-3 py-2 text-base text-[var(--text-strong)] focus:outline-none focus:border-blue-500"
                    value={customFrom}
                    onChange={(e) => setTokenDashboardCustomRange(e.target.value, customTo)}
                  />
                </label>
                <label className="flex items-center gap-2">
                  到
                  <input
                    type="date"
                    className="rounded-md border border-border bg-surface-card px-3 py-2 text-base text-[var(--text-strong)] focus:outline-none focus:border-blue-500"
                    value={customTo}
                    onChange={(e) => setTokenDashboardCustomRange(customFrom, e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {err ? (
              <div className="rounded-lg bg-red-500/15 px-4 py-3 text-base text-status-error">{err}</div>
            ) : null}
            {busy ? <div className="text-sm font-medium text-[var(--text-primary)]">加载中…</div> : null}

            <div className="rounded-xl border border-border bg-surface-card px-5 py-5">
              <div className="text-sm font-medium uppercase tracking-wider text-[var(--text-primary)]">TOTAL TOKENS</div>
              <div className="mt-2 font-mono text-4xl font-semibold tabular-nums text-[var(--text-strong)] sm:text-5xl md:text-6xl">
                {fmtCompact(summary?.tokens ?? 0)}
              </div>
              <div className="mt-3 text-xl font-semibold tabular-nums text-[var(--status-success)]">${fmtUsd(summary?.cost_usd ?? 0)}</div>

              {breakdown.length ? (
                <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-surface-base">
                  {breakdown.map((b, i) => (
                    <div
                      key={b.key}
                      style={{
                        flexGrow: Math.max(1, b.tokens),
                        flexBasis: 0,
                        backgroundColor: PROVIDER_BAR_COLORS[i % PROVIDER_BAR_COLORS.length],
                      }}
                      title={`${b.key}: ${b.percent}%`}
                    />
                  ))}
                </div>
              ) : null}

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {(breakdown.length ? breakdown : []).slice(0, 10).map((b, i) => (
                  <div
                    key={b.key}
                    className="rounded-lg border border-border bg-surface-base px-3 py-2.5 text-sm"
                  >
                    <div className="truncate font-semibold uppercase text-[var(--text-strong)]">{b.key || "(unknown)"}</div>
                    <div className="tabular-nums text-[var(--text-primary)]">{b.percent.toFixed(1)}%</div>
                    <div className="text-xs text-[var(--text-primary)]">
                      {b.model_count != null ? `${b.model_count} models` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface-card">
              <div className="sticky top-0 z-[1] flex gap-2 border-b border-border bg-surface-base px-4 py-3 text-sm font-medium text-[var(--text-strong)]">
                <button type="button" className="agx-topbar-btn--active rounded-md px-3 py-1 text-[var(--text-strong)]">
                  每日明细
                </button>
              </div>
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-surface-base text-[var(--text-strong)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">日期</th>
                    <th className="px-4 py-3 font-semibold">合计</th>
                    <th className="px-4 py-3 font-semibold">输入</th>
                    <th className="px-4 py-3 font-semibold">输出</th>
                    <th className="px-4 py-3 font-semibold">缓存</th>
                    <th className="px-4 py-3 font-semibold">推理</th>
                    <th className="px-4 py-3 font-semibold">会话</th>
                  </tr>
                </thead>
                <tbody className="bg-surface-card">
                  {dailyDesc.map((row) => (
                    <tr key={row.date} className="border-t border-border">
                      <td className="px-4 py-2.5 font-mono text-[var(--text-strong)]">{row.date}</td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-strong)]">{fmtCompact(row.total)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-primary)]">{fmtCompact(row.input)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-primary)]">{fmtCompact(row.output)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-primary)]">{fmtCompact(row.cached)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-primary)]">{fmtCompact(row.reasoning)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-primary)]">{row.convs}</td>
                    </tr>
                  ))}
                  {!dailyDesc.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-base font-medium text-[var(--text-primary)]">
                        暂无数据（新版启用后的用量才会入账）
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

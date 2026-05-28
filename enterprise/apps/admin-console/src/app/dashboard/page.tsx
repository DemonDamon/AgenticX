"use client";
import { adminFetch } from "../../lib/admin-client-auth";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BarCard,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DonutCard,
  EmptyState,
  LineCard,
  PageHeader,
  StatCard,
  chartPalette,
} from "@agenticx/ui";
import type { AuditEvent } from "@agenticx/core-api";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  DollarSign,
  Inbox,
  RefreshCcw,
  ShieldAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

type MeteringRow = {
  dims: Record<string, string | null>;
  total_tokens: number;
  cost_usd: number;
};

type KpiData = {
  calls: number;
  cost: number;
  policyHits: number;
  activeUsers: number;
  callsSeries: Array<{ v: number }>;
  costSeries: Array<{ v: number }>;
};

const REFRESH_MS = 5000;

async function readJsonBody<T>(res: Response, fallback: T): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function DashboardPage() {
  const t = useTranslations("pages.dashboard");
  const ts = useTranslations("shell");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [kpi, setKpi] = useState<KpiData>({
    calls: 0,
    cost: 0,
    policyHits: 0,
    activeUsers: 0,
    callsSeries: [],
    costSeries: [],
  });
  const [meteringRows, setMeteringRows] = useState<MeteringRow[]>([]);
  const [auditItems, setAuditItems] = useState<AuditEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [meteringRes, auditRes] = await Promise.all([
          adminFetch("/api/metering/query", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              start: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
              end: new Date().toISOString(),
              group_by: ["day", "dept", "model"],
            }),
          }),
          adminFetch("/api/audit/query", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: 20 }),
          }),
        ]);
        const emptyMetering = { data: { rows: [] as MeteringRow[] } };
        const emptyAudit = { data: { items: [] as AuditEvent[] } };
        const meteringJson = await readJsonBody<{ data?: { rows?: MeteringRow[] } }>(meteringRes, emptyMetering);
        const auditJson = await readJsonBody<{ data?: { items?: AuditEvent[] } }>(auditRes, emptyAudit);
        if (!active) return;
        const rows = meteringJson.data?.rows ?? [];
        const audits = auditJson.data?.items ?? [];
        setMeteringRows(rows);
        setAuditItems(audits);

        const calls = rows.reduce((sum, row) => sum + Math.max(row.total_tokens, 1), 0);
        const cost = rows.reduce((sum, row) => sum + row.cost_usd, 0);
        const policyHits = audits.reduce((sum, item) => sum + (item.policies_hit?.length ?? 0), 0);
        const activeUsers = new Set(audits.map((item) => item.user_id).filter(Boolean)).size;
        const series = rows.slice(-12);
        setKpi({
          calls,
          cost,
          policyHits,
          activeUsers,
          callsSeries: series.map((row) => ({ v: row.total_tokens })),
          costSeries: series.map((row) => ({ v: Number(row.cost_usd.toFixed(4)) })),
        });
        setLastUpdated(new Date());
      } catch {
        // 会话过期跳转、dev 重启或本机 API 短暂不可达时不应触发 Next 运行时红屏
        if (!active) return;
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  /* ---------- 派生图表数据 ---------- */

  const callsSeriesKey = t("charts.callsSeries");
  const costSeriesKey = t("charts.costSeries");

  const trendData = useMemo(() => {
    return meteringRows.slice(-12).map((row, index) => ({
      bucket: row.dims.day ?? `slot-${index + 1}`,
      [callsSeriesKey]: row.total_tokens,
      [costSeriesKey]: Number(row.cost_usd.toFixed(4)),
    }));
  }, [meteringRows, callsSeriesKey, costSeriesKey]);

  const policyData = useMemo(() => {
    const stats = new Map<string, number>();
    for (const event of auditItems) {
      for (const hit of event.policies_hit ?? []) {
        stats.set(hit.policy_id, (stats.get(hit.policy_id) ?? 0) + 1);
      }
    }
    return Array.from(stats.entries()).map(([name, value], index) => ({
      name,
      value,
      color: chartPalette[index % chartPalette.length],
    }));
  }, [auditItems]);

  const deptModelData = useMemo(() => {
    const map = new Map<string, { dept: string; deepseek: number; moonshot: number; others: number }>();
    for (const row of meteringRows) {
      const dept = row.dims.dept ?? "unknown";
      const model = row.dims.model ?? "others";
      const item = map.get(dept) ?? { dept, deepseek: 0, moonshot: 0, others: 0 };
      if (model.includes("deepseek")) item.deepseek += row.total_tokens;
      else if (model.includes("moonshot")) item.moonshot += row.total_tokens;
      else item.others += row.total_tokens;
      map.set(dept, item);
    }
    return Array.from(map.values());
  }, [meteringRows]);

  const topUsers = useMemo(() => {
    const stats = new Map<string, number>();
    for (const item of auditItems) {
      if (!item.user_id) continue;
      stats.set(item.user_id, (stats.get(item.user_id) ?? 0) + 1);
    }
    return Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [auditItems]);

  /* ---------- 渲染 ---------- */

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/dashboard">{ts("adminLabel")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbDashboard")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={
          lastUpdated
            ? t("descriptionUpdated", {
                time: lastUpdated.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour12: false }),
                seconds: REFRESH_MS / 1000,
              })
            : t("descriptionLoading")
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/audit">
                <Activity />
                {t("viewAudit")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/metering">
                <BarChart3 />
                {t("viewMetering")}
              </Link>
            </Button>
            <Button size="sm" onClick={() => window.location.reload()}>
              <RefreshCcw />
              {tc("actions.refresh")}
            </Button>
          </>
        }
      />

      {/* Welcome banner */}
      <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary-soft via-card to-card">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <CardContent className="relative grid gap-4 p-6 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div className="space-y-2">
            <Badge variant="default" className="bg-primary/90">
              {t("welcomeBadge")}
            </Badge>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {t("welcomeTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("welcomeSummary", {
                users: kpi.activeUsers,
                calls: kpi.calls.toLocaleString(),
                cost: kpi.cost.toFixed(4),
                hits: kpi.policyHits,
              })}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <QuickLink icon={<Users className="h-4 w-4" />} label={t("quickLinks.users")} href="/iam/users" />
            <QuickLink icon={<ShieldAlert className="h-4 w-4" />} label={t("quickLinks.audit")} href="/audit" />
            <QuickLink icon={<BarChart3 className="h-4 w-4" />} label={t("quickLinks.metering")} href="/metering" />
          </div>
        </CardContent>
      </Card>

      {/* KPI stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("stats.callsLabel")}
          value={kpi.calls.toLocaleString()}
          icon={<BarChart3 />}
          delta={{ value: "12.4", trend: "up" }}
          accentClassName="bg-primary"
          footer={<span className="text-xs text-muted-foreground">{t("stats.callsFooter")}</span>}
        />
        <StatCard
          label={t("stats.costLabel")}
          value={`$${kpi.cost.toFixed(4)}`}
          icon={<DollarSign />}
          delta={{ value: "3.1", trend: "up" }}
          accentClassName="bg-chart-3"
          footer={<span className="text-xs text-muted-foreground">{t("stats.costFooter")}</span>}
        />
        <StatCard
          label={t("stats.policyLabel")}
          value={kpi.policyHits.toString()}
          icon={<ShieldAlert />}
          delta={{ value: kpi.policyHits > 0 ? `${kpi.policyHits}` : "0", trend: kpi.policyHits > 0 ? "up" : "flat", suffix: "" }}
          accentClassName="bg-danger"
          footer={<span className="text-xs text-muted-foreground">{t("stats.callsFooter")}</span>}
        />
        <StatCard
          label={t("stats.usersLabel")}
          value={kpi.activeUsers.toString()}
          icon={<Users />}
          delta={{ value: kpi.activeUsers.toString(), trend: "up", suffix: "" }}
          accentClassName="bg-chart-6"
          footer={<span className="text-xs text-muted-foreground">{t("stats.usersFooter")}</span>}
        />
      </section>

      {/* Primary chart + side charts */}
      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <LineCard
          title={t("charts.trendTitle")}
          description={t("charts.trendDescription")}
          variant="area"
          data={trendData}
          xKey="bucket"
          series={[
            { key: callsSeriesKey, color: chartPalette[0] },
            { key: costSeriesKey, color: chartPalette[2] },
          ]}
          height={300}
        />
        <DonutCard
          title={t("charts.policyTitle")}
          description={t("charts.policyDescription")}
          data={policyData}
          height={300}
          centerLabel={
            <div>
              <div className="text-xs text-muted-foreground">{t("charts.policyCenterLabel")}</div>
              <div className="text-2xl font-semibold">{kpi.policyHits}</div>
            </div>
          }
          emptyLabel={t("charts.policyEmpty")}
        />
      </section>

      {/* Dept × Model stacked + top users + audit feed */}
      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <BarCard
          title={t("charts.deptModelTitle")}
          description={t("charts.deptModelDescription")}
          data={deptModelData}
          xKey="dept"
          series={[
            { key: "deepseek", label: "DeepSeek", color: chartPalette[0] },
            { key: "moonshot", label: "Moonshot", color: chartPalette[4] },
            { key: "others", label: t("charts.others"), color: chartPalette[5] },
          ]}
          stacked
          height={280}
        />
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>{t("topUsers.title")}</CardTitle>
              <CardDescription>{t("topUsers.description")}</CardDescription>
            </div>
            <Badge variant="soft" className="gap-1">
              <ArrowUpRight className="h-3 w-3" />
              {t("topUsers.realtime")}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {topUsers.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-5 w-5" />}
                title={t("topUsers.emptyTitle")}
                description={t("topUsers.emptyDescription")}
                size="sm"
                className="border-0"
              />
            ) : (
              topUsers.map(([userId, count], index) => (
                <div key={userId} className="flex items-center gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    #{index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{userId}</div>
                    <div className="text-xs text-muted-foreground">
                      {count} {t("topUsers.eventCount")}
                    </div>
                  </div>
                  <Badge variant="soft">{count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* Recent audit events */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>{t("recentAudit.title")}</CardTitle>
            <CardDescription>{t("recentAudit.description")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/audit">
              {t("recentAudit.viewAll")}
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {auditItems.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={loading ? t("recentAudit.loadingTitle") : t("recentAudit.emptyTitle")}
              description={loading ? t("recentAudit.loadingDescription") : t("recentAudit.emptyDescription")}
              size="sm"
              className="border-0"
            />
          ) : (
            auditItems.slice(0, 10).map((event) => {
              const hitCount = event.policies_hit?.length ?? 0;
              return (
                <Link
                  key={event.id}
                  href={`/audit?event_id=${event.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2 transition-colors hover:border-border-strong hover:bg-muted"
                >
                  <span
                    className={[
                      "h-2 w-2 shrink-0 rounded-full",
                      hitCount > 0 ? "bg-danger" : "bg-success",
                    ].join(" ")}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{event.event_time}</span>
                    <span className="truncate font-medium">{event.event_type}</span>
                    <span className="truncate text-muted-foreground">{event.user_id}</span>
                  </div>
                  <Badge variant={hitCount > 0 ? "destructive" : "soft"} className="shrink-0">
                    {hitCount > 0 ? `${t("recentAudit.hit")} ${hitCount}` : t("recentAudit.compliant")}
                  </Badge>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary-soft"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary group-hover:bg-primary/20">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

"use client";

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
  SparkLine,
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

export default function DashboardPage() {
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
          fetch("/api/metering/query", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              start: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
              end: new Date().toISOString(),
              group_by: ["day", "dept", "model"],
            }),
          }),
          fetch("/api/audit/query", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: 20 }),
          }),
        ]);
        const meteringJson = (await meteringRes.json()) as { data?: { rows?: MeteringRow[] } };
        const auditJson = (await auditRes.json()) as { data?: { items?: AuditEvent[] } };
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

  const trendData = useMemo(() => {
    return meteringRows.slice(-12).map((row, index) => ({
      bucket: row.dims.day ?? `slot-${index + 1}`,
      调用量: row.total_tokens,
      成本: Number(row.cost_usd.toFixed(4)),
    }));
  }, [meteringRows]);

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
                  <Link href="/dashboard">Admin</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="企业总览"
        description={
          lastUpdated
            ? `最近更新：${lastUpdated.toLocaleTimeString("zh-CN", { hour12: false })} · 每 ${REFRESH_MS / 1000} 秒轮询`
            : "正在加载..."
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/audit">
                <Activity />
                查看审计
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/metering">
                <BarChart3 />
                四维消耗
              </Link>
            </Button>
            <Button size="sm" onClick={() => window.location.reload()}>
              <RefreshCcw />
              刷新
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
              欢迎回来
            </Badge>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              AgenticX 企业管控中心
            </h2>
            <p className="text-sm text-muted-foreground">
              今日已为 <span className="font-medium text-foreground">{kpi.activeUsers}</span> 位活跃用户提供{" "}
              <span className="font-medium text-foreground">{kpi.calls.toLocaleString()}</span> 次模型调用，
              成本 <span className="font-medium text-foreground">${kpi.cost.toFixed(4)}</span>
              ，触发合规策略 <span className="font-medium text-danger">{kpi.policyHits}</span> 次。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <QuickLink icon={<Users className="h-4 w-4" />} label="用户管理" href="/iam/users" />
            <QuickLink icon={<ShieldAlert className="h-4 w-4" />} label="审计日志" href="/audit" />
            <QuickLink icon={<BarChart3 className="h-4 w-4" />} label="四维消耗" href="/metering" />
          </div>
        </CardContent>
      </Card>

      {/* KPI stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="今日调用量"
          value={kpi.calls.toLocaleString()}
          icon={<BarChart3 />}
          delta={{ value: "12.4", trend: "up" }}
          accentClassName="bg-primary"
          footer={<SparkLine data={kpi.callsSeries.length ? kpi.callsSeries : [{ v: 0 }, { v: 0 }]} color={chartPalette[0]} />}
        />
        <StatCard
          label="今日消耗（USD）"
          value={`$${kpi.cost.toFixed(4)}`}
          icon={<DollarSign />}
          delta={{ value: "3.1", trend: "up" }}
          accentClassName="bg-chart-3"
          footer={<SparkLine data={kpi.costSeries.length ? kpi.costSeries : [{ v: 0 }, { v: 0 }]} color={chartPalette[2]} />}
        />
        <StatCard
          label="命中合规事件"
          value={kpi.policyHits.toString()}
          icon={<ShieldAlert />}
          delta={{ value: kpi.policyHits > 0 ? `${kpi.policyHits}` : "0", trend: kpi.policyHits > 0 ? "up" : "flat", suffix: "" }}
          accentClassName="bg-danger"
          footer={<span className="text-xs text-muted-foreground">近 24 小时累计</span>}
        />
        <StatCard
          label="活跃用户"
          value={kpi.activeUsers.toString()}
          icon={<Users />}
          delta={{ value: kpi.activeUsers.toString(), trend: "up", suffix: "" }}
          accentClassName="bg-chart-6"
          footer={<span className="text-xs text-muted-foreground">审计窗口内去重</span>}
        />
      </section>

      {/* Primary chart + side charts */}
      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <LineCard
          title="调用量 & 成本趋势"
          description="近 24 小时按天聚合"
          variant="area"
          data={trendData}
          xKey="bucket"
          series={[
            { key: "调用量", color: chartPalette[0] },
            { key: "成本", color: chartPalette[2] },
          ]}
          height={300}
        />
        <DonutCard
          title="策略命中分布"
          description="按规则 ID 统计"
          data={policyData}
          height={300}
          centerLabel={
            <div>
              <div className="text-xs text-muted-foreground">总命中</div>
              <div className="text-2xl font-semibold">{kpi.policyHits}</div>
            </div>
          }
          emptyLabel="无命中事件"
        />
      </section>

      {/* Dept × Model stacked + top users + audit feed */}
      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <BarCard
          title="部门 × 模型消耗"
          description="Token 堆叠对比"
          data={deptModelData}
          xKey="dept"
          series={[
            { key: "deepseek", label: "DeepSeek", color: chartPalette[0] },
            { key: "moonshot", label: "Moonshot", color: chartPalette[4] },
            { key: "others", label: "其它", color: chartPalette[5] },
          ]}
          stacked
          height={280}
        />
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Top 用户</CardTitle>
              <CardDescription>审计事件数前 5</CardDescription>
            </div>
            <Badge variant="soft" className="gap-1">
              <ArrowUpRight className="h-3 w-3" />
              实时
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {topUsers.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-5 w-5" />}
                title="暂无活跃用户"
                description="等待审计事件到达"
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
                    <div className="text-xs text-muted-foreground">{count} 次事件</div>
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
            <CardTitle>最近审计事件</CardTitle>
            <CardDescription>点击跳转详细页</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/audit">
              查看全部
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {auditItems.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={loading ? "加载中..." : "暂无审计事件"}
              description={loading ? "正在拉取最近 20 条记录" : "近 24 小时无事件记录"}
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
                    {hitCount > 0 ? `命中 ${hitCount}` : "合规"}
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

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agenticx/ui";
import type { AuditEvent } from "@agenticx/core-api";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink } from "lucide-react";

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
};

export default function DashboardPage() {
  const [kpi, setKpi] = useState<KpiData>({ calls: 0, cost: 0, policyHits: 0, activeUsers: 0 });
  const [meteringRows, setMeteringRows] = useState<MeteringRow[]>([]);
  const [auditItems, setAuditItems] = useState<AuditEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
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
      setKpi({
        calls: rows.reduce((sum, row) => sum + Math.max(row.total_tokens, 1), 0),
        cost: rows.reduce((sum, row) => sum + row.cost_usd, 0),
        policyHits: audits.reduce((sum, item) => sum + (item.policies_hit?.length ?? 0), 0),
        activeUsers: new Set(audits.map((item) => item.user_id).filter(Boolean)).size,
      });
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const lineData = useMemo(
    () =>
      meteringRows.slice(0, 12).map((row, index) => ({
        bucket: row.dims.day ?? `slot-${index + 1}`,
        calls: row.total_tokens,
        cost: Number(row.cost_usd.toFixed(4)),
      })),
    [meteringRows]
  );

  const policyData = useMemo(() => {
    const stats = new Map<string, number>();
    for (const event of auditItems) {
      for (const hit of event.policies_hit ?? []) {
        stats.set(hit.policy_id, (stats.get(hit.policy_id) ?? 0) + 1);
      }
    }
    return Array.from(stats.entries()).map(([name, hits]) => ({ name, hits }));
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-zinc-400">网关实时状态、审计流、四维消耗可视化</p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="今日调用量" value={kpi.calls.toLocaleString()} />
        <KpiCard title="今日消耗 USD" value={`$${kpi.cost.toFixed(4)}`} />
        <KpiCard title="命中合规事件数" value={kpi.policyHits.toString()} />
        <KpiCard title="活跃用户" value={kpi.activeUsers.toString()} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>网关实时曲线</CardTitle>
            <CardDescription>每 5 秒刷新一次</CardDescription>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="bucket" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="calls" stroke="#38bdf8" strokeWidth={2} />
                <Line type="monotone" dataKey="cost" stroke="#34d399" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>策略命中分布</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={policyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip />
                <Area type="monotone" dataKey="hits" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>最近审计事件</CardTitle>
              <CardDescription>点击查看事件详情</CardDescription>
            </div>
            <a
              href="/audit"
              className="inline-flex items-center rounded-md px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              查看全部
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>事件</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>策略</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditItems.slice(0, 20).map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelectedEvent(item)}>
                    <TableCell>{item.event_time}</TableCell>
                    <TableCell>{item.event_type}</TableCell>
                    <TableCell>{item.user_id}</TableCell>
                    <TableCell>
                      <Badge variant={(item.policies_hit?.length ?? 0) > 0 ? "destructive" : "outline"}>
                        {item.policies_hit?.length ?? 0}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>部门 × 模型</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptModelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="dept" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip />
                <Legend />
                <Bar dataKey="deepseek" stackId="a" fill="#38bdf8" />
                <Bar dataKey="moonshot" stackId="a" fill="#22d3ee" />
                <Bar dataKey="others" stackId="a" fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-3xl border-zinc-700 bg-zinc-950">
          <DialogHeader>
            <DialogTitle>审计事件详情</DialogTitle>
            <DialogDescription>{selectedEvent?.id}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[480px] overflow-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-100">
            {selectedEvent ? JSON.stringify(selectedEvent, null, 2) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}


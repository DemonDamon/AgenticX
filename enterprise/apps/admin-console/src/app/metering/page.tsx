"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@agenticx/ui";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type MeteringRow = {
  dims: Record<string, string | null>;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

const DEPT_USERS: Record<string, Array<{ id: string; name: string }>> = {
  "dept-root": [
    { id: "user_seed_owner", name: "Seed Owner" },
    { id: "user_demo", name: "Demo User" },
  ],
  "dept-ops": [{ id: "user_demo", name: "Demo User" }],
  "dept-audit": [{ id: "user_auditor", name: "Auditor" }],
};

const PROVIDER_MODELS: Record<string, string[]> = {
  deepseek: ["deepseek-chat"],
  moonshot: ["moonshot-v1-8k"],
  "edge-agent": ["local-ollama-llama3"],
};

export default function MeteringPage() {
  const [dept, setDept] = useState("dept-ops");
  const [user, setUser] = useState("user_demo");
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-chat");
  const [start, setStart] = useState(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<MeteringRow[]>([]);
  const [loading, setLoading] = useState(false);

  const users = useMemo(() => DEPT_USERS[dept] ?? [], [dept]);
  const models = useMemo(() => PROVIDER_MODELS[provider] ?? [], [provider]);
  const maxTokens = useMemo(() => Math.max(...rows.map((row) => row.total_tokens), 1), [rows]);

  useEffect(() => {
    if (!users.find((item) => item.id === user)) {
      setUser(users[0]?.id ?? "");
    }
  }, [users, user]);

  useEffect(() => {
    if (!models.includes(model)) {
      setModel(models[0] ?? "");
    }
  }, [models, model]);

  const query = async () => {
    setLoading(true);
    const response = await fetch("/api/metering/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dept_id: dept ? [dept] : [],
        user_id: user ? [user] : [],
        provider: provider ? [provider] : [],
        model: model ? [model] : [],
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`,
        group_by: ["day", "dept", "user", "provider", "model"],
      }),
    });
    const payload = (await response.json()) as { data?: { rows?: MeteringRow[] } };
    setRows(payload.data?.rows ?? []);
    setLoading(false);
  };

  const exportExcel = async () => {
    const response = await fetch("/api/metering/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dept_id: dept ? [dept] : [],
        user_id: user ? [user] : [],
        provider: provider ? [provider] : [],
        model: model ? [model] : [],
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`,
        group_by: ["day", "dept", "user", "provider", "model"],
      }),
    });
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "metering-export.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">四维消耗查询</h1>
        <p className="text-sm text-zinc-400">部门 → 员工 → 厂商/模型 → 时间段 四级联动。</p>
      </div>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>筛选条件</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="space-y-1 text-sm">
            <span>部门</span>
            <select className="h-10 w-full rounded border border-zinc-300 px-2" value={dept} onChange={(event) => setDept(event.target.value)}>
              {Object.keys(DEPT_USERS).map((deptId) => (
                <option key={deptId} value={deptId}>
                  {deptId}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>员工</span>
            <select className="h-10 w-full rounded border border-zinc-300 px-2" value={user} onChange={(event) => setUser(event.target.value)}>
              {users.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>厂商</span>
            <select
              className="h-10 w-full rounded border border-zinc-300 px-2"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              {Object.keys(PROVIDER_MODELS).map((providerName) => (
                <option key={providerName} value={providerName}>
                  {providerName}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>模型</span>
            <select className="h-10 w-full rounded border border-zinc-300 px-2" value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((modelName) => (
                <option key={modelName} value={modelName}>
                  {modelName}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>开始日期</span>
            <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span>结束日期</span>
            <Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={query} disabled={loading}>
          {loading ? "查询中..." : "查询"}
        </Button>
        <Button variant="secondary" onClick={exportExcel}>
          导出 Excel
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>Token 消耗趋势</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows.map((row, index) => ({
                  day: row.dims.day ?? `slot-${index + 1}`,
                  tokens: row.total_tokens,
                  cost: Number(row.cost_usd.toFixed(4)),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="tokens" stroke="#38bdf8" strokeWidth={2} />
                <Line type="monotone" dataKey="cost" stroke="#34d399" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>部门 x 模型分布</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows.map((row, index) => ({
                  name: row.dims.day ?? `slot-${index + 1}`,
                  tokens: row.total_tokens,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip />
                <Bar dataKey="tokens" fill="#38bdf8" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>表格</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="py-2 pr-3">day</th>
                  <th className="py-2 pr-3">tokens</th>
                  <th className="py-2 pr-3">cost(USD)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.dims.day ?? "na"}-${index}`} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-3">{row.dims.day ?? "-"}</td>
                    <td className="py-2 pr-3">{row.total_tokens}</td>
                    <td className="py-2 pr-3">{row.cost_usd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>透视预览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((row, index) => {
              const width = `${Math.max((row.total_tokens / maxTokens) * 100, 2)}%`;
              return (
                <div key={`${row.dims.day ?? "na"}-${index}`} className="space-y-1">
                  <div className="text-xs text-zinc-500">{row.dims.day ?? "-"}</div>
                  <div className="h-3 rounded bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-3 rounded bg-violet-500" style={{ width }} />
                  </div>
                  <div className="text-xs">tokens={row.total_tokens} / cost={row.cost_usd.toFixed(6)}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}


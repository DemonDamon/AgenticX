"use client";

import type { AuditEvent } from "@agenticx/core-api";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@agenticx/ui";
import { useEffect, useMemo, useState } from "react";

type QueryResult = {
  total: number;
  items: AuditEvent[];
  chain_valid: boolean;
};

export default function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [chainValid, setChainValid] = useState(true);
  const [userId, setUserId] = useState("");
  const [model, setModel] = useState("");
  const [policyHit, setPolicyHit] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const response = await fetch("/api/audit/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_id: userId || undefined,
        model: model || undefined,
        policy_hit: policyHit || undefined,
      }),
    });
    const payload = (await response.json()) as { data?: QueryResult };
    const data = payload.data;
    setItems(data?.items ?? []);
    setChainValid(data?.chain_valid ?? false);
    if ((data?.items.length ?? 0) > 0) {
      setSelected(data?.items[0] ?? null);
    } else {
      setSelected(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const exportCsv = async () => {
    const response = await fetch("/api/audit/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_id: userId || undefined,
        model: model || undefined,
        policy_hit: policyHit || undefined,
      }),
    });
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "audit-export.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const statusText = useMemo(() => (chainValid ? "链完整性校验通过" : "链校验失败，请立即排查"), [chainValid]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">审计日志</h1>
        <p className="text-sm text-zinc-500">支持按人员/模型/策略命中过滤，详情抽屉与 CSV 导出。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>过滤器</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-sm">人员（user_id）</label>
            <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user_demo" />
          </div>
          <div className="space-y-1">
            <label className="text-sm">模型</label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-chat" />
          </div>
          <div className="space-y-1">
            <label className="text-sm">策略命中</label>
            <Input value={policyHit} onChange={(event) => setPolicyHit(event.target.value)} placeholder="finance-keyword-insider" />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? "查询中..." : "查询"}
          </Button>
          <Button variant="secondary" onClick={exportCsv}>
            导出 CSV
          </Button>
          <span className={`text-sm ${chainValid ? "text-emerald-600" : "text-red-600"}`}>{statusText}</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>日志列表（{items.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="py-2 pr-3">时间</th>
                    <th className="py-2 pr-3">事件</th>
                    <th className="py-2 pr-3">用户</th>
                    <th className="py-2 pr-3">模型</th>
                    <th className="py-2 pr-3">策略命中</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900"
                      onClick={() => setSelected(item)}
                    >
                      <td className="py-2 pr-3">{item.event_time}</td>
                      <td className="py-2 pr-3">{item.event_type}</td>
                      <td className="py-2 pr-3">{item.user_id}</td>
                      <td className="py-2 pr-3">{item.model}</td>
                      <td className="py-2 pr-3">{item.policies_hit?.length ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>详情抽屉</CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(selected, null, 2)}</pre>
            ) : (
              <p className="text-sm text-zinc-500">点击左侧行查看详情。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}


"use client";

import type { AuditEvent } from "@agenticx/core-api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@agenticx/ui";
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
    <main className="mx-auto max-w-[1400px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">审计日志</h1>
        <p className="text-sm text-zinc-400">支持按人员/模型/策略命中过滤，详情抽屉与 CSV 导出。</p>
      </div>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>过滤器</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>人员（user_id）</Label>
            <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user_demo" />
          </div>
          <div className="space-y-1">
            <Label>模型</Label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-chat" />
          </div>
          <div className="space-y-1">
            <Label>策略命中</Label>
            <Input value={policyHit} onChange={(event) => setPolicyHit(event.target.value)} placeholder="finance-keyword-insider" />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? "查询中..." : "查询"}
          </Button>
          <Button variant="secondary" onClick={exportCsv}>
            导出 CSV
          </Button>
          <Badge variant={chainValid ? "success" : "destructive"}>{statusText}</Badge>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <CardTitle>日志列表（{items.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>事件</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>策略命中</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelected(item)}>
                    <TableCell>{item.event_time}</TableCell>
                    <TableCell>{item.event_type}</TableCell>
                    <TableCell>{item.user_id}</TableCell>
                    <TableCell>{item.model}</TableCell>
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

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl border-zinc-700 bg-zinc-950">
          <DialogHeader>
            <DialogTitle>审计详情</DialogTitle>
            <DialogDescription>{selected?.id}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(selected, null, 2)}</pre>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}


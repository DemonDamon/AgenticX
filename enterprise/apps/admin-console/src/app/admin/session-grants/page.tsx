"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { Plus, Trash2 } from "lucide-react";

type GrantRow = {
  id: string;
  sessionId: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  description: string | null;
};

export default function SessionGrantsPage() {
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ sessionId: "", scopes: "metering:read", ttlSeconds: "600", description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/session-grants");
      const json = (await res.json()) as { code?: string; data?: { grants?: GrantRow[] }; message?: string };
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "load failed");
      setGrants(json.data?.grants ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    try {
      const res = await adminFetch("/api/admin/session-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: form.sessionId,
          scopes: form.scopes.split(",").map((s) => s.trim()).filter(Boolean),
          ttlSeconds: Number(form.ttlSeconds || 600),
          description: form.description || undefined,
        }),
      });
      const json = (await res.json()) as { code?: string; message?: string };
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "create failed");
      toast.success("会话临时授权已签发");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "签发失败");
    }
  };

  const onRevoke = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/session-grants?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as { code?: string; message?: string };
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "revoke failed");
      toast.success("已吊销");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "吊销失败");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink asChild><Link href="/dashboard">管理台</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>会话临时授权</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="会话临时授权"
        description="为 sessionId 在 TTL 内授予额外 scope；吊销后网关近实时失效。"
      />

      <Card>
        <CardHeader><CardTitle>签发临时授权</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Session ID</Label>
            <Input value={form.sessionId} onChange={(e) => setForm((p) => ({ ...p, sessionId: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>TTL（秒）</Label>
            <Input type="number" value={form.ttlSeconds} onChange={(e) => setForm((p) => ({ ...p, ttlSeconds: e.target.value }))} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Scopes（逗号分隔）</Label>
            <Input value={form.scopes} onChange={(e) => setForm((p) => ({ ...p, scopes: e.target.value }))} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>说明</Label>
            <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <Button type="button" onClick={onCreate} disabled={loading}>
            <Plus className="h-4 w-4" /> 签发
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>授权列表</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无记录</p>
          ) : (
            grants.map((g) => (
              <div key={g.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{g.sessionId}</div>
                  <div className="text-muted-foreground">{g.scopes.join(", ")}</div>
                  <div className="text-xs text-muted-foreground">expires {g.expiresAt}{g.revokedAt ? ` · revoked ${g.revokedAt}` : ""}</div>
                </div>
                {!g.revokedAt ? (
                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => void onRevoke(g.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

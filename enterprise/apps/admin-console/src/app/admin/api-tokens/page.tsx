"use client";

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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { KeyRound, Plus, Trash2 } from "lucide-react";

type PatRow = {
  id: number;
  name: string;
  tokenPrefix: string;
  status: string;
  expireAt: string | null;
  lastUsedAt: string | null;
  userId: string;
};

async function readJsonBody<T>(res: Response, fallback: T): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export default function ApiTokensPage() {
  const [tokens, setTokens] = useState<PatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [plainToken, setPlainToken] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", userId: "", expireDays: "90" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/api-tokens");
      const json = await readJsonBody(res, { code: "50000", message: "empty response", data: { tokens: [] as PatRow[] } });
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "load failed");
      setTokens(json.data?.tokens ?? []);
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
      const res = await fetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          userId: form.userId,
          expireDays: Number(form.expireDays) || 90,
        }),
      });
      const json = await readJsonBody(res, { code: "50000", message: "empty response" });
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "create failed");
      setPlainToken(json.data?.token ?? null);
      setOpen(false);
      setForm({ name: "", userId: "", expireDays: "90" });
      await load();
      toast.success("API Token 已创建，请立即复制明文");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const onRevoke = async (id: number) => {
    if (!confirm("确定吊销该 Token？")) return;
    const res = await fetch(`/api/admin/api-tokens/${id}`, { method: "DELETE" });
    const json = await readJsonBody(res, { code: "50000", message: "empty response" });
    if (!res.ok || json.code !== "00000") {
      toast.error(json.message || "吊销失败");
      return;
    }
    toast.success("已吊销");
    await load();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">首页</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>API Tokens</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title="API Tokens"
        description="为企业用户或系统集成签发 agx-pat-* 令牌，供网关 M2M 鉴权。"
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> 新建 Token
          </Button>
        }
      />

      {plainToken ? (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-sm">明文 Token（仅显示一次）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block break-all rounded bg-muted p-3 text-xs">{plainToken}</code>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(plainToken)}>
              复制
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPlainToken(null)}>
              我已保存，关闭
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : (
        <div className="grid gap-3">
          {tokens.map((t) => (
            <Card key={t.id}>
              <CardContent className="flex items-center justify-between gap-4 pt-4">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <KeyRound className="h-4 w-4" /> {t.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.tokenPrefix}… · 用户 {t.userId} · {t.status}
                    {t.lastUsedAt ? ` · 最近使用 ${t.lastUsedAt}` : ""}
                  </p>
                </div>
                {t.status === "active" ? (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onRevoke(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 API Token</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>归属用户 ID</Label>
              <Input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
            </div>
            <div>
              <Label>有效天数</Label>
              <Input value={form.expireDays} onChange={(e) => setForm({ ...form, expireDays: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void onCreate()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

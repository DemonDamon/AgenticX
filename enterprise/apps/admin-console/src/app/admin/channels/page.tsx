"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { Activity, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";

interface ChannelRow {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  weight: number;
  priority: number;
  status: string;
  supportedModels: string[];
  apiKeyConfigured: boolean;
}

type HealthStat = {
  success_count?: number;
  failure_count?: number;
  success_rate?: number;
  p50_latency_ms?: number;
  last_error?: string;
  cooldown_until?: string | null;
};

type EditForm = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  weight: string;
  priority: string;
  models: string;
  status: "active" | "disabled";
  providerLabel: string;
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [stats, setStats] = useState<Record<string, HealthStat>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    weight: "1",
    models: "",
    providerLabel: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/channels/health");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setChannels(json.data.channels ?? []);
      setStats(json.data.stats ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载 Channel 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    try {
      const models = form.models
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          weight: Number(form.weight) || 1,
          supportedModels: models,
          metadata: form.providerLabel ? { provider: form.providerLabel, route: "third-party" } : {},
        }),
      });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "create failed");
      toast.success("Channel 已创建");
      setOpen(false);
      setForm({ name: "", baseUrl: "", apiKey: "", weight: "1", models: "", providerLabel: "" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const openEdit = (ch: ChannelRow) => {
    setEditing({
      id: ch.id,
      name: ch.name,
      baseUrl: ch.baseUrl,
      apiKey: "",
      weight: String(ch.weight ?? 1),
      priority: String(ch.priority ?? 0),
      models: (ch.supportedModels ?? []).join(", "),
      status: ch.status === "disabled" ? "disabled" : "active",
      providerLabel: ch.providerType ?? "",
    });
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    try {
      const models = editing.models
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        name: editing.name,
        baseUrl: editing.baseUrl,
        weight: Number(editing.weight) || 1,
        priority: Number(editing.priority) || 0,
        status: editing.status,
        supportedModels: models,
      };
      if (editing.apiKey.trim() !== "") body.apiKey = editing.apiKey;
      if (editing.providerLabel.trim() !== "") {
        body.metadata = { provider: editing.providerLabel, route: "third-party" };
      }
      const res = await fetch(`/api/admin/channels/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "update failed");
      toast.success("Channel 已更新");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新失败");
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("确定删除该 Channel？")) return;
    const res = await fetch(`/api/admin/channels/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.code !== "00000") {
      toast.error(json.message || "删除失败");
      return;
    }
    toast.success("已删除");
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
            <BreadcrumbPage>Channel 管理</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title="Channel 管理"
        description="同一逻辑模型可绑定多个上游 Channel，支持加权路由、失败重试与健康面板。"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCcw className="mr-1 h-4 w-4" /> 刷新
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> 新建 Channel
            </Button>
          </div>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title="暂无 Channel"
          description="创建 Channel 后，在 Gateway 进程设置 GATEWAY_CHANNEL_REGISTRY=on 并配置 GATEWAY_REMOTE_CHANNELS_URL 指向 internal API。"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => {
            const health = stats[ch.id];
            const rate = health?.success_rate != null ? `${Math.round(health.success_rate * 100)}%` : "—";
            return (
              <Card key={ch.id}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{ch.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{ch.baseUrl}</p>
                    </div>
                    <Badge variant={ch.status === "active" ? "default" : "secondary"}>{ch.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>权重 {ch.weight} · 优先级 {ch.priority}</p>
                    <p>模型：{ch.supportedModels.join(", ") || "—"}</p>
                    <p>Key：{ch.apiKeyConfigured ? "已配置" : "未配置"}</p>
                    <p>
                      成功率：{rate}
                      {typeof health?.p50_latency_ms === "number" && health.p50_latency_ms > 0
                        ? ` · p50 ${health.p50_latency_ms} ms`
                        : ""}
                    </p>
                    {health?.cooldown_until ? (
                      <p className="text-amber-600">Cooldown 至 {health.cooldown_until}</p>
                    ) : null}
                    {health?.last_error ? <p className="text-destructive truncate">最近错误：{health.last_error}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(ch)}>
                      <Pencil className="mr-1 h-4 w-4" /> 编辑
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onDelete(ch.id)}>
                      <Trash2 className="mr-1 h-4 w-4" /> 删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Base URL</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
            </div>
            <div>
              <Label>API Key</Label>
              <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </div>
            <div>
              <Label>Provider 标识（metadata.provider）</Label>
              <Input value={form.providerLabel} onChange={(e) => setForm({ ...form, providerLabel: e.target.value })} placeholder="deepseek" />
            </div>
            <div>
              <Label>支持模型（逗号或换行分隔）</Label>
              <Input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} placeholder="deepseek-chat" />
            </div>
            <div>
              <Label>权重</Label>
              <Input value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void onCreate()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing != null} onOpenChange={(v) => (!v ? setEditing(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑 Channel</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div>
                <Label>名称</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Base URL</Label>
                <Input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
              </div>
              <div>
                <Label>API Key（留空保留原值）</Label>
                <Input
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  placeholder="******"
                />
              </div>
              <div>
                <Label>Provider 标识</Label>
                <Input value={editing.providerLabel} onChange={(e) => setEditing({ ...editing, providerLabel: e.target.value })} />
              </div>
              <div>
                <Label>支持模型（逗号或换行分隔）</Label>
                <Input value={editing.models} onChange={(e) => setEditing({ ...editing, models: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>权重</Label>
                  <Input value={editing.weight} onChange={(e) => setEditing({ ...editing, weight: e.target.value })} />
                </div>
                <div>
                  <Label>优先级</Label>
                  <Input value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>状态</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={editing.status === "active" ? "default" : "outline"}
                    onClick={() => setEditing({ ...editing, status: "active" })}
                  >
                    启用
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editing.status === "disabled" ? "default" : "outline"}
                    onClick={() => setEditing({ ...editing, status: "disabled" })}
                  >
                    禁用
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={() => void onSaveEdit()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

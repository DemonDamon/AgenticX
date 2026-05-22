"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Switch,
  toast,
} from "@agenticx/ui";
import { Database, RefreshCcw, Save, Trash2 } from "lucide-react";
import type { GatewayCacheConfig } from "../../../lib/gateway-cache-store";

const DEFAULT: GatewayCacheConfig = {
  l1_enabled: true,
  l2_enabled: false,
  l1_ttl_minutes: 5,
  semantic_threshold: 0.92,
  replay_mode: "burst",
  model_allowlist: [],
  model_blocklist: [],
  l2_embedding_model: "",
};

export default function AdminCachePage() {
  const [config, setConfig] = useState<GatewayCacheConfig>(DEFAULT);
  const [allowlist, setAllowlist] = useState("");
  const [blocklist, setBlocklist] = useState("");
  const [evictPrefix, setEvictPrefix] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cache");
      const json = (await res.json()) as { data?: GatewayCacheConfig };
      const data = json.data ?? DEFAULT;
      setConfig(data);
      setAllowlist(data.model_allowlist.join(","));
      setBlocklist(data.model_blocklist.join(","));
    } catch {
      toast.error("加载缓存配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload: GatewayCacheConfig = {
        ...config,
        model_allowlist: allowlist.split(",").map((s) => s.trim()).filter(Boolean),
        model_blocklist: blocklist.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch("/api/admin/cache", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("缓存配置已保存");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function evict() {
    try {
      const res = await fetch("/api/admin/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix: evictPrefix }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("已提交缓存驱逐");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "驱逐失败");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="AI 缓存"
        description="管理网关 L1 精确缓存与 L2 语义缓存开关、阈值与模型名单。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            缓存策略
          </CardTitle>
          <CardDescription>L1 默认开启（TTL 5 分钟）；L2 默认关闭，需显式启用。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>L1 精确缓存</Label>
              <p className="text-muted-foreground text-sm">相同 canonical 请求直接命中</p>
            </div>
            <Switch checked={config.l1_enabled} onCheckedChange={(v) => setConfig((c) => ({ ...c, l1_enabled: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>L2 语义缓存</Label>
              <p className="text-muted-foreground text-sm">embedding 相似度 ≥ 阈值时命中</p>
            </div>
            <Switch checked={config.l2_enabled} onCheckedChange={(v) => setConfig((c) => ({ ...c, l2_enabled: v }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l1-ttl">L1 TTL（分钟）</Label>
            <Input
              id="l1-ttl"
              type="number"
              min={1}
              value={config.l1_ttl_minutes}
              onChange={(e) => setConfig((c) => ({ ...c, l1_ttl_minutes: Number(e.target.value) || 5 }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="semantic-threshold">L2 相似度阈值</Label>
            <Input
              id="semantic-threshold"
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={config.semantic_threshold}
              onChange={(e) => setConfig((c) => ({ ...c, semantic_threshold: Number(e.target.value) || 0.92 }))}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="allowlist">模型白名单（逗号分隔，留空=全部）</Label>
            <Input id="allowlist" value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="gpt-4o,claude-3-5-sonnet-latest" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="blocklist">模型黑名单</Label>
            <Input id="blocklist" value={blocklist} onChange={(e) => setBlocklist(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="embedding-model">L2 Embedding 模型</Label>
            <Input
              id="embedding-model"
              value={config.l2_embedding_model}
              onChange={(e) => setConfig((c) => ({ ...c, l2_embedding_model: e.target.value }))}
              placeholder="text-embedding-3-small"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={() => void save()} disabled={saving || loading}>
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>人工驱逐</CardTitle>
          <CardDescription>按 key hash 前缀驱逐 L1 缓存条目（Redis / 内存）。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="evict-prefix">Key 前缀</Label>
            <Input id="evict-prefix" value={evictPrefix} onChange={(e) => setEvictPrefix(e.target.value)} placeholder="可选，留空清除全部" />
          </div>
          <Button variant="destructive" onClick={() => void evict()}>
            <Trash2 className="mr-2 h-4 w-4" />
            驱逐
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

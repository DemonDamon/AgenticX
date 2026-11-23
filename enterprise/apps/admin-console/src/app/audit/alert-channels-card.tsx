"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@agenticx/ui";
import { Bell, Plus, Save, Trash2 } from "lucide-react";
import { adminFetch } from "../../lib/admin-client-auth";

type AlertChannel = {
  type: "webhook" | "feishu";
  url: string;
  minSeverity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
};

type TenantAlertChannels = {
  channels: AlertChannel[];
  dedupWindowSeconds?: number;
  rateLimitPerMinute?: number;
};

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export function AlertChannelsCard() {
  const [tenantId, setTenantId] = useState("default");
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [dedupWindow, setDedupWindow] = useState(600);
  const [rateLimit, setRateLimit] = useState(10);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (tenant: string) => {
    if (!tenant.trim()) return;
    try {
      const res = await adminFetch(`/api/admin/alerts/channels?tenant=${encodeURIComponent(tenant)}`);
      const json = (await res.json()) as { data: TenantAlertChannels | null };
      setChannels(json.data?.channels ?? []);
      setDedupWindow(json.data?.dedupWindowSeconds ?? 600);
      setRateLimit(json.data?.rateLimitPerMinute ?? 10);
      setLoaded(true);
    } catch {
      toast.error("加载告警通道失败");
    }
  }, []);

  useEffect(() => {
    void load("default");
  }, [load]);

  const save = async () => {
    if (!tenantId.trim()) {
      toast.error("请输入租户 ID");
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/alerts/channels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          config: {
            channels,
            dedupWindowSeconds: dedupWindow,
            rateLimitPerMinute: rateLimit,
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(`保存失败：${json.message ?? res.status}`);
        return;
      }
      toast.success("告警通道已保存，网关将在 10 秒内热加载");
    } finally {
      setSaving(false);
    }
  };

  const removeTenant = async () => {
    setSaving(true);
    try {
      await adminFetch(`/api/admin/alerts/channels?tenant=${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
      });
      setChannels([]);
      toast.success("已删除该租户的告警通道");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          <span className="text-sm font-medium">告警分发通道</span>
          <Badge variant="secondary">policy_hit / 预算告警 / 审计链校验失败</Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          命中策略、预算超限或审计链校验失败时，按租户分发到 webhook / 飞书群机器人；去重窗口与通道限流防止告警风暴。未配置的租户不分发。
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>租户 ID</Label>
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              onBlur={() => void load(tenantId)}
              placeholder="default"
            />
          </div>
          <div className="space-y-1">
            <Label>去重窗口（秒）</Label>
            <Input
              type="number"
              value={dedupWindow}
              min={60}
              onChange={(e) => setDedupWindow(Number(e.target.value) || 600)}
            />
          </div>
          <div className="space-y-1">
            <Label>通道限流（条/分钟）</Label>
            <Input
              type="number"
              value={rateLimit}
              min={1}
              onChange={(e) => setRateLimit(Number(e.target.value) || 10)}
            />
          </div>
        </div>

        {channels.map((channel, idx) => (
          <div key={idx} className="grid gap-3 md:grid-cols-[140px_1fr_160px_40px]">
            <Select
              value={channel.type}
              onValueChange={(value) => {
                const next = [...channels];
                next[idx] = { ...channel, type: value as AlertChannel["type"] };
                setChannels(next);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webhook">Webhook</SelectItem>
                <SelectItem value="feishu">飞书机器人</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={channel.url}
              onChange={(e) => {
                const next = [...channels];
                next[idx] = { ...channel, url: e.target.value };
                setChannels(next);
              }}
              placeholder={
                channel.type === "feishu"
                  ? "https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  : "https://ops.example.com/hook"
              }
            />
            <Select
              value={channel.minSeverity ?? "MEDIUM"}
              onValueChange={(value) => {
                const next = [...channels];
                next[idx] = { ...channel, minSeverity: value as AlertChannel["minSeverity"] };
                setChannels(next);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((sev) => (
                  <SelectItem key={sev} value={sev}>
                    ≥ {sev}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChannels(channels.filter((_, i) => i !== idx))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setChannels([...channels, { type: "webhook", url: "", minSeverity: "MEDIUM" }])}
          >
            <Plus className="h-4 w-4" />
            添加通道
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "保存中..." : "保存"}
          </Button>
          {loaded && channels.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void removeTenant()} disabled={saving}>
              <Trash2 className="h-4 w-4" />
              删除配置
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

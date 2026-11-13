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
import { Save, ShieldCheck, Trash2 } from "lucide-react";
import { adminFetch } from "../../lib/admin-client-auth";

type TenantModerationConfig = {
  enabled: boolean;
  mode: "degraded" | "strict";
  blockSeverity?: "critical" | "high" | "medium" | "low";
  timeoutSeconds?: number;
  categories?: string[];
  provider: {
    type: "http";
    name?: string;
    url: string;
    apiKey?: string;
  };
};

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const CATEGORY_OPTIONS = ["politics", "porn", "terrorism", "ad"] as const;

export function ModerationCard() {
  const [tenantId, setTenantId] = useState("default");
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<"degraded" | "strict">("degraded");
  const [blockSeverity, setBlockSeverity] = useState<string>("critical");
  const [timeoutSeconds, setTimeoutSeconds] = useState(3);
  const [categories, setCategories] = useState<string[]>(["politics", "porn", "terrorism", "ad"]);
  const [providerName, setProviderName] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (tenant: string) => {
    if (!tenant.trim()) return;
    try {
      const res = await adminFetch(`/api/admin/security/moderation?tenant=${encodeURIComponent(tenant)}`);
      const json = (await res.json()) as { data: TenantModerationConfig | null };
      const cfg = json.data;
      setEnabled(cfg?.enabled ?? false);
      setMode(cfg?.mode ?? "degraded");
      setBlockSeverity(cfg?.blockSeverity ?? "critical");
      setTimeoutSeconds(cfg?.timeoutSeconds ?? 3);
      setCategories(cfg?.categories ?? ["politics", "porn", "terrorism", "ad"]);
      setProviderName(cfg?.provider?.name ?? "");
      setProviderUrl(cfg?.provider?.url ?? "");
      setApiKey(cfg?.provider?.apiKey ?? "");
    } catch {
      toast.error("加载内容安全配置失败");
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
    if (enabled && !providerUrl.trim()) {
      toast.error("启用前必须填写 provider URL");
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/security/moderation", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          config: {
            enabled,
            mode,
            blockSeverity: blockSeverity as TenantModerationConfig["blockSeverity"],
            timeoutSeconds,
            categories,
            provider: {
              type: "http" as const,
              name: providerName.trim(),
              url: providerUrl.trim(),
              apiKey: apiKey.trim(),
            },
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(`保存失败：${json.message ?? res.status}`);
        return;
      }
      toast.success("内容安全配置已保存，网关将在 10 秒内热加载");
    } finally {
      setSaving(false);
    }
  };

  const removeTenant = async () => {
    setSaving(true);
    try {
      await adminFetch(`/api/admin/security/moderation?tenant=${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
      });
      setEnabled(false);
      setProviderUrl("");
      setApiKey("");
      toast.success("已删除该租户的内容安全配置（回到现状等价）");
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-sm font-medium">第三方内容安全审核</span>
          <Badge variant="secondary">SP3 compliance-moderation</Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          按租户接入第三方内容安全 API（provider 可插拔，通用 JSON 契约）。请求侧在本地规则通过后调用、非流式在终态、流式在流尾；命中先落审计再返回 90001/90002。
          provider 故障时 degraded 模式降级本地规则兜底并发 CRITICAL 告警；strict 模式按租户选装 fail-closed。未配置的租户零行为变化。
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>租户 ID</Label>
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="default"
            />
          </div>
          <div className="space-y-1">
            <Label>启用</Label>
            <Select value={enabled ? "on" : "off"} onValueChange={(v) => setEnabled(v === "on")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="off">关闭（现状等价）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>降级模式</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "degraded" | "strict")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="degraded">degraded（默认，故障降级本地规则）</SelectItem>
                <SelectItem value="strict">strict（故障 fail-closed）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>拦截级别</Label>
            <Select value={blockSeverity} onValueChange={setBlockSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Provider 名称</Label>
            <Input
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="vendor-x"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Provider URL（通用 JSON 契约）</Label>
            <Input
              value={providerUrl}
              onChange={(e) => setProviderUrl(e.target.value)}
              placeholder="https://content-safety.example.com/check"
            />
          </div>
          <div className="space-y-1">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>审核类别</Label>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((cat) => (
              <Button
                key={cat}
                type="button"
                size="sm"
                variant={categories.includes(cat) ? "default" : "outline"}
                onClick={() => toggleCategory(cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label>超时（秒）</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value) || 3)}
            className="w-32"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />
            保存
          </Button>
          <Button variant="outline" onClick={removeTenant} disabled={saving}>
            <Trash2 className="mr-1 h-4 w-4" />
            删除租户配置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

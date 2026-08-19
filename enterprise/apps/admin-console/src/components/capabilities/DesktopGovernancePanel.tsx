"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  toast,
} from "@agenticx/ui";
import {
  DEFAULT_DESKTOP_CAPABILITY_POLICY,
  normalizeDesktopCapabilityPolicy,
  type DesktopCapabilityPolicy,
} from "@agenticx/config";
import { Loader2, RefreshCcw } from "lucide-react";

import { adminFetch } from "../../lib/admin-client-auth";

type Envelope<T> = { code: string; message: string; data?: T };

const SWITCHES: {
  key: keyof DesktopCapabilityPolicy;
  label: string;
  hint: string;
}[] = [
  {
    key: "allowLocalSkillInstall",
    label: "允许员工自行安装 Skill",
    hint: "关闭后桌面端隐藏「技能来源与扫描路径」，员工只能使用能力包下发的技能。",
  },
  {
    key: "allowLocalMcpInstall",
    label: "允许员工自行添加 MCP",
    hint: "关闭后隐藏配置文件路径、添加远程 MCP 与 JSON 编辑；从企业网关导入不受影响。",
  },
  {
    key: "allowMcpAutoDiscovery",
    label: "允许扫描本机 MCP 配置",
    hint: "桌面端打开 MCP 设置时会读取本机其它 AI 工具的配置路径。关闭后连扫都不扫。",
  },
];

/**
 * 桌面端自助安装的管控开关。
 *
 * 和会话额度同住 enterprise_runtime_budgets 那份配置，所以复用 /api/metering/budget，
 * 不另开接口——这三项和额度一样，都是「这个租户的桌面端受什么约束」。
 */
export function DesktopGovernancePanel() {
  const [policy, setPolicy] = useState<DesktopCapabilityPolicy>(
    DEFAULT_DESKTOP_CAPABILITY_POLICY,
  );
  // 写回时带上读到的版本：这份配置也放着额度规则，盲写会把别人刚改的额度冲掉。
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/metering/budget", { cache: "no-store" });
      const json = (await res.json()) as Envelope<{ budget?: Record<string, unknown> }>;
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "读取失败");
      setPolicy(normalizeDesktopCapabilityPolicy(json.data?.budget?.desktopCapabilityPolicy));
      const version = json.data?.budget?.updatedAt;
      setUpdatedAt(typeof version === "string" ? version : null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取桌面管控失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(
    async (key: keyof DesktopCapabilityPolicy, value: boolean) => {
      // 先本地反映，失败再回滚：开关点下去没反应比慢一点更让人怀疑是不是坏了。
      const previous = policy;
      const next = { ...policy, [key]: value };
      setPolicy(next);
      setSaving(true);
      try {
        const res = await adminFetch("/api/metering/budget", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            desktopCapabilityPolicy: next,
            ...(updatedAt ? { expectedUpdatedAt: updatedAt } : {}),
          }),
        });
        const json = (await res.json()) as Envelope<{ budget?: { updatedAt?: string } }>;
        if (!res.ok || json.code !== "00000") throw new Error(json.message || "保存失败");
        const version = json.data?.budget?.updatedAt;
        setUpdatedAt(typeof version === "string" ? version : null);
        toast.success("已保存，桌面端下次同步生效");
      } catch (error) {
        setPolicy(previous);
        toast.error(error instanceof Error ? error.message : "保存桌面管控失败");
      } finally {
        setSaving(false);
      }
    },
    [policy, updatedAt],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>桌面端自助安装</CardTitle>
          <CardDescription>
            关掉之后，员工能用什么完全由这里分配的能力包决定。改动随桌面端下次同步下发，
            不影响已经登录的会话立即可用的能力。
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          刷新
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {SWITCHES.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="font-medium">{item.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.hint}</p>
            </div>
            <Switch
              checked={policy[item.key]}
              disabled={loading || saving}
              onCheckedChange={(checked) => void update(item.key, checked)}
              aria-label={item.label}
            />
          </div>
        ))}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            读取中…
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

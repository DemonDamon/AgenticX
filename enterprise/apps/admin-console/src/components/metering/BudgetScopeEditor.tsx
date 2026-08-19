"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@agenticx/ui";
import { Loader2 } from "lucide-react";

import { adminFetch } from "../../lib/admin-client-auth";

export type BudgetScope = "departments" | "users";

type BudgetRule = {
  unit: "cost_usd" | "tokens";
  period: "day" | "week" | "month";
  limit: number;
  warnThresholdPct?: number;
  action: "warn" | "block" | "fallback";
  fallbackModel?: string;
};

type BudgetConfig = Record<string, unknown> & {
  updatedAt?: string;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

type Envelope<T> = { code?: string; message?: string; data?: T };

const EMPTY: BudgetRule = {
  unit: "cost_usd",
  period: "month",
  limit: 0,
  warnThresholdPct: 80,
  action: "warn",
};

/**
 * 某个部门 / 某个人的**花钱**上限。
 *
 * 和额度（QuotaScopeEditor）是两回事，摆在一起是故意的：额度管的是发多少 token，预算
 * 管的是花多少钱，同一个对象上两个上限先撞上哪个就是哪个。分在两个页面看，只会得到
 * 「明明还有额度为什么被拦」。
 *
 * 原来这两组规则在预算页上一个「把 ID 贴进输入框」的表里——想给某个部门配预算，得先去
 * 别处找到那串 ULID 再粘回来，配完了也认不出那行是谁。
 *
 * 写回时只动自己这一条，其余原样带回，并带上 expectedUpdatedAt：这份配置是整份 PUT 的，
 * 而且服务端做乐观并发；不带回原值会把别人刚配的抹掉，不带版本号会悄悄覆盖。
 */
export function BudgetScopeEditor({
  scope,
  id,
  onSaved,
}: {
  scope: BudgetScope;
  id: string;
  onSaved?: () => void;
}) {
  const [config, setConfig] = useState<BudgetConfig | null>(null);
  const [rule, setRule] = useState<BudgetRule>(EMPTY);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/metering/budget", { cache: "no-store" });
      const json = (await res.json()) as Envelope<{ budget?: BudgetConfig }>;
      if (!res.ok) throw new Error(json.message || "读取预算失败");
      const budget = json.data?.budget ?? {};
      setConfig(budget);
      const existing = (budget[scope] ?? {})[id];
      setEnabled(Boolean(existing));
      setRule(existing ?? EMPTY);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取预算失败");
    } finally {
      setLoading(false);
    }
  }, [id, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const map = { ...(config[scope] ?? {}) };
      // 关掉开关 = 删掉这条规则，回落到租户默认；不是把上限设成 0——0 在这里的含义是
      // 「不启用」，但留着一条规则会让人以为这个对象被单独配过。
      if (enabled) map[id] = rule;
      else delete map[id];
      const res = await adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, [scope]: map, expectedUpdatedAt: config.updatedAt }),
      });
      const json = (await res.json()) as Envelope<{ budget?: BudgetConfig }>;
      if (!res.ok || !json.data?.budget) {
        throw new Error(
          res.status === 409
            ? "预算已被其他管理员更新，请刷新后重试"
            : json.message || "保存预算失败",
        );
      }
      toast.success(enabled ? "预算已保存" : "已改为继承默认预算");
      await load();
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存预算失败");
    } finally {
      setSaving(false);
    }
  }, [config, enabled, id, load, onSaved, rule, scope]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        读取中…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">单独设置预算</p>
          <p className="mt-1 text-xs text-muted-foreground">
            关闭则继承租户默认预算。预算管的是花多少钱，和上面的 Token 额度各算各的，
            先撞上哪个就被哪个拦。
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="单独设置预算" />
      </div>

      {enabled ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">按什么算</Label>
            <Select
              value={rule.unit}
              onValueChange={(value) =>
                setRule((current) => ({ ...current, unit: value as BudgetRule["unit"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cost_usd">成本 USD</SelectItem>
                <SelectItem value="tokens">词元</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">周期</Label>
            <Select
              value={rule.period}
              onValueChange={(value) =>
                setRule((current) => ({ ...current, period: value as BudgetRule["period"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">日</SelectItem>
                <SelectItem value="week">周</SelectItem>
                <SelectItem value="month">月</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">硬上限</Label>
            <Input
              type="number"
              step="any"
              value={String(rule.limit)}
              onChange={(event) =>
                setRule((current) => ({ ...current, limit: Number(event.target.value || 0) }))
              }
            />
            <p className="text-[11px] text-muted-foreground">0 表示不启用</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">预警阈值 %</Label>
            <Input
              type="number"
              value={String(rule.warnThresholdPct ?? 80)}
              onChange={(event) =>
                setRule((current) => ({
                  ...current,
                  warnThresholdPct: Number(event.target.value || 0),
                }))
              }
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">超限动作</Label>
            <Select
              value={rule.action}
              onValueChange={(value) =>
                setRule((current) => ({ ...current, action: value as BudgetRule["action"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">warn · 只告警，照常放行</SelectItem>
                <SelectItem value="block">block · 直接拦下</SelectItem>
                <SelectItem value="fallback">fallback · 切到备用模型</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

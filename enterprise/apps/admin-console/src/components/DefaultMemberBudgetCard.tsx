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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "@agenticx/ui";
import { Save } from "lucide-react";
import { adminFetch, readAdminJsonResponse } from "../lib/admin-client-auth";
import type { BudgetConfig } from "../lib/company-monthly-limits";
import {
  DEFAULT_MEMBER_BUDGET,
  defaultMemberBudget,
  normalizeBudgetLimit,
  withDefaultMemberBudget,
  type DefaultMemberBudget,
} from "../lib/default-member-budget";

type BudgetEnvelope = { code: string; message: string; data?: { budget?: BudgetConfig } };

/**
 * 所有人默认走的那一条预算。部门 / 个人编辑器覆盖它。
 *
 * 「按 Token 还是按美元」在这里是一个二选一的开关，而不是两条各自生效的上限：
 * 一条规则只有一个 unit，网关按那个单位结算。要区分云厂商按量付费和私有化部署的
 * 固定成本，靠的是 pricing.yaml 里的 billing_multiplier（私有化那几个已置 0），
 * 而不是在这里配两套。
 */
export function DefaultMemberBudgetCard() {
  const [config, setConfig] = useState<BudgetConfig | null>(null);
  const [draft, setDraft] = useState<DefaultMemberBudget>(DEFAULT_MEMBER_BUDGET);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/budget", { cache: "no-store" });
      const json = await readAdminJsonResponse<BudgetEnvelope>(response, "读取默认预算失败");
      if (!response.ok || json.code !== "00000" || !json.data?.budget) {
        throw new Error(json.message || "读取默认预算失败");
      }
      setConfig(json.data.budget);
      setDraft(defaultMemberBudget(json.data.budget));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取默认预算失败");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withDefaultMemberBudget(config, draft)),
      });
      const json = await readAdminJsonResponse<BudgetEnvelope>(response, "保存默认预算失败");
      if (!response.ok || json.code !== "00000" || !json.data?.budget) {
        throw new Error(
          response.status === 409
            ? "预算已被其他管理员更新，请刷新后重试"
            : json.message || "保存默认预算失败",
        );
      }
      setConfig(json.data.budget);
      setDraft(defaultMemberBudget(json.data.budget));
      toast.success(draft.enabled ? "默认预算已保存" : "已关闭默认预算");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存默认预算失败");
    } finally {
      setSaving(false);
    }
  };

  const unitLabel = draft.unit === "tokens" ? "Token" : "美元";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle>默认成员预算</CardTitle>
          <CardDescription className="mt-1">
            没有单独配过的成员都走这一条。按 Token 还是按美元二选一，同一条规则只按一种单位结算；
            部门和个人的单独设置会覆盖它。
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={loading || saving || !config}>
          <Save className="h-4 w-4" />
          {saving ? "保存中…" : "保存"}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">启用默认预算</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  关闭则不设默认上限，只有单独配过的成员受限。
                </p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft((cur) => ({ ...cur, enabled }))}
                aria-label="启用默认预算"
              />
            </div>

            {draft.enabled ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">按什么算</Label>
                  <Select
                    value={draft.unit}
                    onValueChange={(value) =>
                      setDraft((cur) => {
                        const unit = value as DefaultMemberBudget["unit"];
                        // 换单位时把上限按新单位归一化：Token 不接受小数。
                        return { ...cur, unit, limit: normalizeBudgetLimit(unit, cur.limit) };
                      })
                    }
                  >
                    <SelectTrigger aria-label="按什么算">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost_usd">成本 USD</SelectItem>
                      <SelectItem value="tokens">Token</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">周期</Label>
                  <Select
                    value={draft.period}
                    onValueChange={(value) =>
                      setDraft((cur) => ({
                        ...cur,
                        period: value as DefaultMemberBudget["period"],
                      }))
                    }
                  >
                    <SelectTrigger aria-label="周期">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">每日</SelectItem>
                      <SelectItem value="week">每周</SelectItem>
                      <SelectItem value="month">每月</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">每人上限（{unitLabel}）</Label>
                  <Input
                    type="number"
                    step={draft.unit === "tokens" ? "1" : "any"}
                    value={String(draft.limit)}
                    onChange={(event) =>
                      setDraft((cur) => ({ ...cur, limit: Number(event.target.value || 0) }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">预警阈值 %</Label>
                  <Input
                    type="number"
                    value={String(draft.warnThresholdPct)}
                    onChange={(event) =>
                      setDraft((cur) => ({
                        ...cur,
                        warnThresholdPct: Number(event.target.value || 0),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">超限动作</Label>
                  <Select
                    value={draft.action}
                    onValueChange={(value) =>
                      setDraft((cur) => ({
                        ...cur,
                        action: value as DefaultMemberBudget["action"],
                      }))
                    }
                  >
                    <SelectTrigger aria-label="超限动作">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";
import { adminFetch } from "../../lib/admin-client-auth";
import { CompanyMonthlyLimitsCard } from "../CompanyMonthlyLimitsCard";
import { QuotaUsageBar, type UsageSnapshot } from "../../components/QuotaUsageBar";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  toast,
} from "@agenticx/ui";
import { Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

type QuotaAction = "block" | "warn" | "fallback";
type QuotaRule = {
  monthlyTokens: number;
  dailyTokens?: number;
  weeklyTokens?: number;
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
  requestsPerDay?: number;
  requestsPerWeek?: number;
  requestsPerMonth?: number;
  poolScope?: "" | "dept" | "tenant";
  action: QuotaAction;
};
type QuotaConfig = {
  defaults: { role: Record<string, QuotaRule>; model: Record<string, QuotaRule> };
  users: Record<string, QuotaRule>;
  departments: Record<string, QuotaRule>;
  apiTokens?: Record<string, QuotaRule>;
  updatedAt: string;
};

type BudgetAction = "block" | "warn" | "fallback";
type BudgetRule = {
  unit: "cost_usd" | "tokens";
  period: "day" | "week" | "month";
  limit: number;
  warnThresholdPct?: number;
  action: BudgetAction;
  fallbackModel?: string;
};
type BudgetConfig = {
  updatedAt: string;
  companyLimits?: { tokens: number; costUsd: number };
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};
type BudgetAlert = {
  id: string;
  dimension: string;
  dimensionKey: string;
  period: string;
  unit: string;
  alertType: string;
  usedValue: string;
  limitValue: string;
  warnThresholdPct: string;
  description: string | null;
  createdAt: string;
};

const EMPTY_BUDGET: BudgetConfig = {
  updatedAt: "",
  companyLimits: { tokens: 0, costUsd: 0 },
  defaults: { unit: "cost_usd", period: "month", limit: 0, warnThresholdPct: 80, action: "warn" },
  tenants: {},
  departments: {},
  users: {},
};

const EMPTY_BUDGET_RULE: BudgetRule = {
  unit: "cost_usd",
  period: "month",
  limit: 0,
  warnThresholdPct: 80,
  action: "warn",
};

const EMPTY: QuotaConfig = {
  defaults: { role: {}, model: {} },
  users: {},
  departments: {},
  apiTokens: {},
  updatedAt: "",
};

const EMPTY_RULE: QuotaRule = {
  monthlyTokens: 0,
  dailyTokens: 0,
  weeklyTokens: 0,
  tpm: 0,
  rpm: 0,
  maxConcurrency: 0,
  requestsPerDay: 0,
  requestsPerWeek: 0,
  requestsPerMonth: 0,
  poolScope: "",
  action: "warn",
};

function usageKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

async function fetchUsage(scope: string, id: string): Promise<UsageSnapshot | null> {
  const res = await adminFetch(
    `/api/metering/quota/usage?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: UsageSnapshot };
  return json.data ?? null;
}

async function loadAllUsages(config: QuotaConfig): Promise<Record<string, UsageSnapshot>> {
  const tasks: Array<Promise<[string, UsageSnapshot | null]>> = [];
  for (const id of Object.keys(config.departments)) {
    tasks.push(
      fetchUsage("dept", id).then((row) => [usageKey("dept", id), row] as [string, UsageSnapshot | null]),
    );
  }
  for (const id of Object.keys(config.users)) {
    tasks.push(
      fetchUsage("user", id).then((row) => [usageKey("user", id), row] as [string, UsageSnapshot | null]),
    );
  }
  for (const id of Object.keys(config.apiTokens ?? {})) {
    tasks.push(
      fetchUsage("pat", id).then((row) => [usageKey("pat", id), row] as [string, UsageSnapshot | null]),
    );
  }
  const tenantPool = Object.values(config.defaults.role).some((r) => r.poolScope === "tenant");
  if (tenantPool) {
    tasks.push(fetchUsage("tenant", "current").then((row) => [usageKey("tenant", "current"), row] as [string, UsageSnapshot | null]));
  }
  const entries = await Promise.all(tasks);
  const next: Record<string, UsageSnapshot> = {};
  for (const [key, row] of entries) {
    if (row) next[key] = row;
  }
  return next;
}


function BudgetRuleEditor({
  label,
  rule,
  onChange,
  onRemove,
}: {
  label: string;
  rule: BudgetRule;
  onChange: (patch: Partial<BudgetRule>) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))_auto] items-end gap-2 rounded-md border border-border px-3 py-3">
      <div className="font-medium text-sm pb-2">{label}</div>
      <div className="space-y-1">
        <Label className="text-xs">单位</Label>
        <Select value={rule.unit} onValueChange={(v) => onChange({ unit: v as BudgetRule["unit"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cost_usd">成本 USD</SelectItem>
            <SelectItem value="tokens">词元</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">周期</Label>
        <Select value={rule.period} onValueChange={(v) => onChange({ period: v as BudgetRule["period"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="day">日</SelectItem>
            <SelectItem value="week">周</SelectItem>
            <SelectItem value="month">月</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">硬上限</Label>
        <Input type="number" step="any" value={rule.limit} onChange={(e) => onChange({ limit: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">预警 %</Label>
        <Input type="number" value={rule.warnThresholdPct ?? 80} onChange={(e) => onChange({ warnThresholdPct: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">超限动作</Label>
        <Select value={rule.action} onValueChange={(v) => onChange({ action: v as BudgetAction })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="block">block</SelectItem>
            <SelectItem value="fallback">fallback</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <div />
      )}
      {rule.action === "fallback" ? (
        <div className="col-span-full space-y-1">
          <Label className="text-xs">降级模型</Label>
          <Input value={rule.fallbackModel ?? ""} placeholder="gpt-4o-mini" onChange={(e) => onChange({ fallbackModel: e.target.value })} />
        </div>
      ) : null}
    </div>
  );
}

export function BudgetPanel() {
  const t = useTranslations("pages.ops.quota");
  const tc = useTranslations("common");
  const [quota, setQuota] = useState<QuotaConfig>(EMPTY);
  const [budget, setBudget] = useState<BudgetConfig>(EMPTY_BUDGET);
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([]);
  const [usageByKey, setUsageByKey] = useState<Record<string, UsageSnapshot>>({});
  const [usageLoading, setUsageLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPat, setNewPat] = useState("");
  const [newBudgetDept, setNewBudgetDept] = useState("");
  const [newBudgetUser, setNewBudgetUser] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [quotaRes, budgetRes, alertsRes] = await Promise.all([
        adminFetch("/api/metering/quota", { cache: "no-store" }),
        adminFetch("/api/metering/budget", { cache: "no-store" }),
        adminFetch("/api/metering/budget?view=alerts&limit=50", { cache: "no-store" }),
      ]);
      const quotaJson = (await quotaRes.json()) as { data?: { quota?: QuotaConfig } };
      const budgetJson = (await budgetRes.json()) as { data?: { budget?: BudgetConfig } };
      const alertsJson = (await alertsRes.json()) as { data?: { alerts?: BudgetAlert[] } };
      const nextQuota = { ...EMPTY, ...(quotaJson.data?.quota ?? EMPTY), apiTokens: quotaJson.data?.quota?.apiTokens ?? {} };
      setQuota(nextQuota);
      setBudget({ ...EMPTY_BUDGET, ...(budgetJson.data?.budget ?? EMPTY_BUDGET) });
      setBudgetAlerts(alertsJson.data?.alerts ?? []);
      setUsageLoading(true);
      void loadAllUsages(nextQuota)
        .then(setUsageByKey)
        .finally(() => setUsageLoading(false));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveQuota = async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: quota.updatedAt,
          defaults: quota.defaults,
          users: quota.users,
          departments: quota.departments,
          apiTokens: quota.apiTokens ?? {},
        }),
      });
      const json = (await response.json()) as {
        message?: string;
        data?: { quota?: QuotaConfig };
      };
      if (!response.ok || !json.data?.quota) {
        toast.error(
          response.status === 409
            ? "配额已被其他管理员更新，请刷新后重试"
            : (json.message ?? tc("toast.saveFailed")),
        );
        return;
      }
      setQuota({ ...EMPTY, ...json.data.quota, apiTokens: json.data.quota.apiTokens ?? {} });
      toast.success("配额已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const saveBudget = async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...budget, expectedUpdatedAt: budget.updatedAt }),
      });
      const json = (await response.json()) as {
        message?: string;
        data?: { budget?: BudgetConfig };
      };
      if (!response.ok || !json.data?.budget) {
        toast.error(
          response.status === 409
            ? "预算已被其他管理员更新，请刷新后重试"
            : (json.message ?? tc("toast.saveFailed")),
        );
        return;
      }
      setBudget({ ...EMPTY_BUDGET, ...json.data.budget });
      toast.success("预算已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const updateMap = (scope: "users" | "departments" | "apiTokens", key: string, patch: Partial<QuotaRule>) => {
    setQuota((prev) => ({
      ...prev,
      [scope]: {
        ...(prev[scope] ?? {}),
        [key]: { ...(prev[scope]?.[key] ?? EMPTY_RULE), ...patch },
      },
    }));
  };

  const addMapKey = (scope: "users" | "departments" | "apiTokens", key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setQuota((prev) => ({
      ...prev,
      [scope]: { ...(prev[scope] ?? {}), [trimmed]: prev[scope]?.[trimmed] ?? { ...EMPTY_RULE } },
    }));
  };

  const removeMapKey = (scope: "users" | "departments" | "apiTokens", key: string) => {
    setQuota((prev) => {
      const next = { ...(prev[scope] ?? {}) };
      delete next[key];
      return { ...prev, [scope]: next };
    });
  };

  const updateBudgetMap = (scope: "users" | "departments" | "tenants", key: string, patch: Partial<BudgetRule>) => {
    setBudget((prev) => ({
      ...prev,
      [scope]: {
        ...(prev[scope] ?? {}),
        [key]: { ...(prev[scope]?.[key] ?? EMPTY_BUDGET_RULE), ...patch },
      },
    }));
  };

  const addBudgetMapKey = (scope: "users" | "departments" | "tenants", key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBudget((prev) => ({
      ...prev,
      [scope]: { ...(prev[scope] ?? {}), [trimmed]: prev[scope]?.[trimmed] ?? { ...EMPTY_BUDGET_RULE } },
    }));
  };

  const removeBudgetMapKey = (scope: "users" | "departments" | "tenants", key: string) => {
    setBudget((prev) => {
      const next = { ...(prev[scope] ?? {}) };
      delete next[key];
      return { ...prev, [scope]: next };
    });
  };

  return (
    <div className="space-y-5">

      <CompanyMonthlyLimitsCard />

      {/* 这一页只管「钱」：全公司预算、成本规则、预算告警。
          token 额度不在这里——全员默认在成员页工具栏，部门额度在部门树，个人额度在成员
          卡片，PAT 额度在访问凭据。同一个额度曾经有四个入口，改哪个生效说不清。 */}
          <Card>
            <CardHeader>
              <CardTitle>默认预算</CardTitle>
              <CardDescription>
                保存后发布快照，网关经 GATEWAY_REMOTE_BUDGET_CONFIG_URL 拉取；limit=0 表示不启用。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {budget.defaults ? (
                <BudgetRuleEditor
                  label="租户默认"
                  rule={budget.defaults}
                  onChange={(patch) => setBudget((prev) => ({ ...prev, defaults: { ...(prev.defaults ?? EMPTY_BUDGET_RULE), ...patch } }))}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>部门预算</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder={t("deptIdPlaceholder")} value={newBudgetDept} onChange={(e) => setNewBudgetDept(e.target.value)} />
                <Button type="button" variant="outline" onClick={() => { addBudgetMapKey("departments", newBudgetDept); setNewBudgetDept(""); }}>
                  <Plus className="h-4 w-4" /> {tc("actions.add")}
                </Button>
              </div>
              {Object.entries(budget.departments ?? {}).map(([id, rule]) => (
                <BudgetRuleEditor key={id} label={id} rule={rule} onChange={(patch) => updateBudgetMap("departments", id, patch)} onRemove={() => removeBudgetMapKey("departments", id)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>用户预算</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder={t("userIdPlaceholder")} value={newBudgetUser} onChange={(e) => setNewBudgetUser(e.target.value)} />
                <Button type="button" variant="outline" onClick={() => { addBudgetMapKey("users", newBudgetUser); setNewBudgetUser(""); }}>
                  <Plus className="h-4 w-4" /> {tc("actions.add")}
                </Button>
              </div>
              {Object.entries(budget.users ?? {}).map(([id, rule]) => (
                <BudgetRuleEditor key={id} label={id} rule={rule} onChange={(patch) => updateBudgetMap("users", id, patch)} onRemove={() => removeBudgetMapKey("users", id)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>预算告警（只读）</CardTitle>
              <CardDescription>预警与熔断事件，由网关写入 gateway_budget_alerts。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {budgetAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无告警记录</p>
              ) : (
                budgetAlerts.map((row) => (
                  <div key={row.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span className="font-medium">{row.alertType}</span>
                      <span>{row.dimension}/{row.dimensionKey}</span>
                      <span>{row.period}</span>
                      <span>{row.unit}</span>
                    </div>
                    <div className="text-muted-foreground">
                      used {row.usedValue} / limit {row.limitValue}
                      {row.warnThresholdPct ? ` · warn ${row.warnThresholdPct}%` : ""}
                    </div>
                    {row.description ? <div>{row.description}</div> : null}
                    <div className="text-xs text-muted-foreground">{row.createdAt}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
    </div>
  );
}

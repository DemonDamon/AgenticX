"use client";
import { adminFetch } from "../../../lib/admin-client-auth";
import { QuotaUsageBar, type UsageSnapshot } from "../../../components/QuotaUsageBar";

import { useEffect, useState } from "react";
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
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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

type ModelPricingEntry = {
  input: number;
  output: number;
  reasoningOutput?: number;
  cachedInput?: number;
  surcharges?: Array<{
    name?: string;
    when: { contextTokensGte?: number; hasReasoning?: boolean };
    addPerM?: number;
    multiplierPct?: number;
    applyTo?: string;
  }>;
};

type PricingConfig = {
  version: string;
  default: ModelPricingEntry;
  models: Record<string, ModelPricingEntry[]>;
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

const EMPTY_PRICING: PricingConfig = {
  version: "",
  default: { input: 0, output: 0 },
  models: {},
  updatedAt: "",
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

function RuleEditor({
  label,
  rule,
  onChange,
  onRemove,
  showPoolScope = false,
  usage,
  usageLoading = false,
}: {
  label: string;
  rule: QuotaRule;
  onChange: (patch: Partial<QuotaRule>) => void;
  onRemove?: () => void;
  showPoolScope?: boolean;
  usage?: UsageSnapshot | null;
  usageLoading?: boolean;
}) {
  const tf = useTranslations("pages.ops.quota.fields");

  return (
    <div className="grid grid-cols-[140px_repeat(11,minmax(0,1fr))_auto] items-end gap-2 rounded-md border border-border px-3 py-3">
      <div className="font-medium text-sm pb-2">{label}</div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("monthlyTokens")}</Label>
        <Input type="number" value={rule.monthlyTokens} onChange={(e) => onChange({ monthlyTokens: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("dailyTokens")}</Label>
        <Input type="number" value={rule.dailyTokens ?? 0} onChange={(e) => onChange({ dailyTokens: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("weeklyTokens")}</Label>
        <Input type="number" value={rule.weeklyTokens ?? 0} onChange={(e) => onChange({ weeklyTokens: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("tpm")}</Label>
        <Input type="number" value={rule.tpm ?? 0} onChange={(e) => onChange({ tpm: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("rpm")}</Label>
        <Input type="number" value={rule.rpm ?? 0} onChange={(e) => onChange({ rpm: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("concurrency")}</Label>
        <Input type="number" value={rule.maxConcurrency ?? 0} onChange={(e) => onChange({ maxConcurrency: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("requestsPerDay")}</Label>
        <Input type="number" value={rule.requestsPerDay ?? 0} onChange={(e) => onChange({ requestsPerDay: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("requestsPerWeek")}</Label>
        <Input type="number" value={rule.requestsPerWeek ?? 0} onChange={(e) => onChange({ requestsPerWeek: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("requestsPerMonth")}</Label>
        <Input type="number" value={rule.requestsPerMonth ?? 0} onChange={(e) => onChange({ requestsPerMonth: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("policy")}</Label>
        <Select value={rule.action} onValueChange={(v) => onChange({ action: v as QuotaAction })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="block">block</SelectItem>
            <SelectItem value="fallback">fallback</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {showPoolScope ? (
        <div className="space-y-1">
          <Label className="text-xs">共享池</Label>
          <Select
            value={rule.poolScope || "none"}
            onValueChange={(v) => onChange({ poolScope: v === "none" ? "" : (v as "dept" | "tenant") })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">每成员独立</SelectItem>
              <SelectItem value="dept">部门共享池</SelectItem>
              <SelectItem value="tenant">租户共享池</SelectItem>
            </SelectContent>
          </Select>
          <QuotaUsageBar usage={usage} loading={usageLoading} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs opacity-0">用量</Label>
          <QuotaUsageBar usage={usage} loading={usageLoading} />
        </div>
      )}
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <div />
      )}
    </div>
  );
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

export default function MeteringQuotaPage() {
  const t = useTranslations("pages.ops.quota");
  const tc = useTranslations("common");
  const [quota, setQuota] = useState<QuotaConfig>(EMPTY);
  const [pricing, setPricing] = useState<PricingConfig>(EMPTY_PRICING);
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
      const [quotaRes, pricingRes, budgetRes, alertsRes] = await Promise.all([
        adminFetch("/api/metering/quota", { cache: "no-store" }),
        adminFetch("/api/metering/pricing", { cache: "no-store" }),
        adminFetch("/api/metering/budget", { cache: "no-store" }),
        adminFetch("/api/metering/budget?view=alerts&limit=50", { cache: "no-store" }),
      ]);
      const quotaJson = (await quotaRes.json()) as { data?: { quota?: QuotaConfig } };
      const pricingJson = (await pricingRes.json()) as { data?: { pricing?: PricingConfig } };
      const budgetJson = (await budgetRes.json()) as { data?: { budget?: BudgetConfig } };
      const alertsJson = (await alertsRes.json()) as { data?: { alerts?: BudgetAlert[] } };
      const nextQuota = { ...EMPTY, ...(quotaJson.data?.quota ?? EMPTY), apiTokens: quotaJson.data?.quota?.apiTokens ?? {} };
      setQuota(nextQuota);
      setPricing({ ...EMPTY_PRICING, ...(pricingJson.data?.pricing ?? EMPTY_PRICING) });
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

  const save = async () => {
    const [quotaRes, pricingRes, budgetRes] = await Promise.all([
      adminFetch("/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(quota),
      }),
      adminFetch("/api/metering/pricing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pricing),
      }),
      adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(budget),
      }),
    ]);
    if (!quotaRes.ok || !pricingRes.ok || !budgetRes.ok) {
      toast.error(tc("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.saveSuccess"));
    await load();
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
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/dashboard">{tc("breadcrumb.admin")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/metering">{tc("breadcrumb.metering")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbQuota")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <Button size="sm" onClick={save} disabled={loading}>
            <Save className="h-4 w-4" />
            {tc("actions.save")}
          </Button>
        }
      />

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">{t("tabs.roles")}</TabsTrigger>
          <TabsTrigger value="departments">{t("tabs.departments")}</TabsTrigger>
          <TabsTrigger value="users">{t("tabs.users")}</TabsTrigger>
          <TabsTrigger value="pats">{t("tabs.pats")}</TabsTrigger>
          <TabsTrigger value="pricing">计价</TabsTrigger>
          <TabsTrigger value="budget">预算</TabsTrigger>
          <TabsTrigger value="budget-alerts">预算告警</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("roleDefaultsTitle")}</CardTitle>
              <CardDescription>{t("roleDefaultsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(quota.defaults.role).map(([role, rule]) => (
                <RuleEditor
                  key={role}
                  label={role}
                  rule={rule}
                  showPoolScope
                  usage={
                    rule.poolScope === "tenant"
                      ? usageByKey[usageKey("tenant", "current")]
                      : undefined
                  }
                  usageLoading={usageLoading}
                  onChange={(patch) =>
                  setQuota((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      role: { ...prev.defaults.role, [role]: { ...rule, ...patch } },
                    },
                  }))
                }
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder={t("deptIdPlaceholder")} value={newDept} onChange={(e) => setNewDept(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => { addMapKey("departments", newDept); setNewDept(""); }}>
              <Plus className="h-4 w-4" /> {tc("actions.add")}
            </Button>
          </div>
          {Object.entries(quota.departments).map(([id, rule]) => (
            <RuleEditor
              key={id}
              label={id}
              rule={rule}
              showPoolScope
              usage={usageByKey[usageKey("dept", id)]}
              usageLoading={usageLoading}
              onChange={(patch) => updateMap("departments", id, patch)}
              onRemove={() => removeMapKey("departments", id)}
            />
          ))}
        </TabsContent>

        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder={t("userIdPlaceholder")} value={newUser} onChange={(e) => setNewUser(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => { addMapKey("users", newUser); setNewUser(""); }}>
              <Plus className="h-4 w-4" /> {tc("actions.add")}
            </Button>
          </div>
          {Object.entries(quota.users).map(([id, rule]) => (
            <RuleEditor
              key={id}
              label={id}
              rule={rule}
              usage={usageByKey[usageKey("user", id)]}
              usageLoading={usageLoading}
              onChange={(patch) => updateMap("users", id, patch)}
              onRemove={() => removeMapKey("users", id)}
            />
          ))}
        </TabsContent>

        <TabsContent value="pats" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder={t("patIdPlaceholder")} value={newPat} onChange={(e) => setNewPat(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => { addMapKey("apiTokens", newPat); setNewPat(""); }}>
              <Plus className="h-4 w-4" /> {tc("actions.add")}
            </Button>
          </div>
          {Object.entries(quota.apiTokens ?? {}).map(([id, rule]) => (
            <RuleEditor
              key={id}
              label={t("patLabel", { id })}
              rule={rule}
              usage={usageByKey[usageKey("pat", id)]}
              usageLoading={usageLoading}
              onChange={(patch) => updateMap("apiTokens", id, patch)}
              onRemove={() => removeMapKey("apiTokens", id)}
            />
          ))}
        </TabsContent>

        <TabsContent value="pricing" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>默认词元单价（USD / token）</CardTitle>
              <CardDescription>
                保存后发布快照，网关经 GATEWAY_REMOTE_PRICING_CONFIG_URL 拉取；当前版本 {pricing.version || "—"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">输入</Label>
                <Input
                  type="number"
                  step="any"
                  value={pricing.default.input}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      default: { ...prev.default, input: Number(e.target.value || 0) },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">输出</Label>
                <Input
                  type="number"
                  step="any"
                  value={pricing.default.output}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      default: { ...prev.default, output: Number(e.target.value || 0) },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">推理输出</Label>
                <Input
                  type="number"
                  step="any"
                  value={pricing.default.reasoningOutput ?? 0}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      default: { ...prev.default, reasoningOutput: Number(e.target.value || 0) },
                    }))
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>模型单价</CardTitle>
              <CardDescription>按模型覆盖默认价；复杂场景可在配置 JSON 中扩展 surcharges。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(pricing.models).map(([model, entries]) => {
                const entry = entries[0] ?? { input: 0, output: 0 };
                return (
                  <div key={model} className="grid grid-cols-[160px_repeat(2,minmax(0,1fr))] items-end gap-2 rounded-md border border-border px-3 py-3">
                    <div className="font-medium text-sm pb-2">{model}</div>
                    <div className="space-y-1">
                      <Label className="text-xs">输入</Label>
                      <Input
                        type="number"
                        step="any"
                        value={entry.input}
                        onChange={(e) =>
                          setPricing((prev) => ({
                            ...prev,
                            models: {
                              ...prev.models,
                              [model]: [{ ...entry, input: Number(e.target.value || 0) }],
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">输出</Label>
                      <Input
                        type="number"
                        step="any"
                        value={entry.output}
                        onChange={(e) =>
                          setPricing((prev) => ({
                            ...prev,
                            models: {
                              ...prev.models,
                              [model]: [{ ...entry, output: Number(e.target.value || 0) }],
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budget" className="mt-4 space-y-4">
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
        </TabsContent>

        <TabsContent value="budget-alerts" className="mt-4">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

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
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
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

const EMPTY_RULE: QuotaRule = { monthlyTokens: 0, tpm: 0, rpm: 0, maxConcurrency: 0, action: "warn" };

function RuleEditor({
  label,
  rule,
  onChange,
  onRemove,
}: {
  label: string;
  rule: QuotaRule;
  onChange: (patch: Partial<QuotaRule>) => void;
  onRemove?: () => void;
}) {
  const tf = useTranslations("pages.ops.quota.fields");

  return (
    <div className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))_auto] items-end gap-2 rounded-md border border-border px-3 py-3">
      <div className="font-medium text-sm pb-2">{label}</div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("monthlyTokens")}</Label>
        <Input type="number" value={rule.monthlyTokens} onChange={(e) => onChange({ monthlyTokens: Number(e.target.value || 0) })} />
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

export default function MeteringQuotaPage() {
  const t = useTranslations("pages.ops.quota");
  const tc = useTranslations("common");
  const [quota, setQuota] = useState<QuotaConfig>(EMPTY);
  const [pricing, setPricing] = useState<PricingConfig>(EMPTY_PRICING);
  const [loading, setLoading] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPat, setNewPat] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [quotaRes, pricingRes] = await Promise.all([
        adminFetch("/api/metering/quota", { cache: "no-store" }),
        adminFetch("/api/metering/pricing", { cache: "no-store" }),
      ]);
      const quotaJson = (await quotaRes.json()) as { data?: { quota?: QuotaConfig } };
      const pricingJson = (await pricingRes.json()) as { data?: { pricing?: PricingConfig } };
      setQuota({ ...EMPTY, ...(quotaJson.data?.quota ?? EMPTY), apiTokens: quotaJson.data?.quota?.apiTokens ?? {} });
      setPricing({ ...EMPTY_PRICING, ...(pricingJson.data?.pricing ?? EMPTY_PRICING) });
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
    const [quotaRes, pricingRes] = await Promise.all([
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
    ]);
    if (!quotaRes.ok || !pricingRes.ok) {
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
        </TabsList>

        <TabsContent value="roles" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("roleDefaultsTitle")}</CardTitle>
              <CardDescription>{t("roleDefaultsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(quota.defaults.role).map(([role, rule]) => (
                <RuleEditor key={role} label={role} rule={rule} onChange={(patch) =>
                  setQuota((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      role: { ...prev.defaults.role, [role]: { ...rule, ...patch } },
                    },
                  }))
                } />
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
            <RuleEditor key={id} label={id} rule={rule} onChange={(patch) => updateMap("departments", id, patch)} onRemove={() => removeMapKey("departments", id)} />
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
            <RuleEditor key={id} label={id} rule={rule} onChange={(patch) => updateMap("users", id, patch)} onRemove={() => removeMapKey("users", id)} />
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
            <RuleEditor key={id} label={t("patLabel", { id })} rule={rule} onChange={(patch) => updateMap("apiTokens", id, patch)} onRemove={() => removeMapKey("apiTokens", id)} />
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
      </Tabs>
    </div>
  );
}

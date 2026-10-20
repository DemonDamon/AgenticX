"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FEATURE_USAGE_FIELDS,
  FEATURE_USAGE_WINDOWS,
  type FeatureUsageConfig,
  type FeatureUsageWindow,
  type MeteredFeature,
} from "@agenticx/config";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";
import {
  budgetSaveBody,
  featureSaveBody,
  fixedSpendingAction,
  selectSpendingUnit,
  spendingDraftFromRule,
  type BudgetDocument,
  type LimitScope,
  type SpendingAction,
  type SpendingDraft,
  type SpendingRule,
} from "../../lib/limit-editor-model";

type BudgetEnvelope = { code: string; message: string; data?: { budget?: BudgetDocument } };
type QuotaEnvelope = { code: string; message: string; data?: { quota?: { updatedAt?: string; featureUsage?: FeatureUsageConfig } } };

type FeatureDraft = Record<FeatureUsageWindow, string>;

const EMPTY_FEATURE: FeatureDraft = { day: "", week: "", month: "" };

function featureDraftFrom(config: FeatureUsageConfig | undefined, scope: LimitScope, id: string, feature: MeteredFeature): FeatureDraft {
  const target = scope === "defaults" ? "staff" : id;
  const rule = scope === "defaults"
    ? config?.defaults?.role?.[target]
    : config?.[scope]?.[target];
  const fields = FEATURE_USAGE_FIELDS[feature];
  const draft = { ...EMPTY_FEATURE };
  for (const window of FEATURE_USAGE_WINDOWS) {
    const value = rule?.[fields[window]];
    if (value && value > 0) draft[window] = String(value);
  }
  return draft;
}

function featureEnabled(draft: FeatureDraft): boolean {
  return FEATURE_USAGE_WINDOWS.some((window) => draft[window] !== "");
}

function featureValues(draft: FeatureDraft): Partial<Record<FeatureUsageWindow, number>> {
  const values: Partial<Record<FeatureUsageWindow, number>> = {};
  for (const window of FEATURE_USAGE_WINDOWS) {
    if (draft[window] === "") continue;
    values[window] = Number(draft[window]);
  }
  return values;
}

const COPY_KEY = {
  defaults: "defaults",
  groups: "groups",
  users: "users",
  departments: "departments",
} as const;

export function LimitEditor({
  scope,
  id,
  onSaved,
  initial,
}: {
  scope: LimitScope;
  id?: string;
  onSaved?: () => void;
  /** Skip the network load. Tests and story fixtures use this. */
  initial?: { budget: BudgetDocument; featureUsage?: FeatureUsageConfig };
}) {
  const t = useTranslations("pages.iam.limits");
  const copy = COPY_KEY[scope];
  const targetId = id ?? "";
  const [budget, setBudget] = useState<BudgetDocument | null>(initial?.budget ?? null);
  const [featureUsage, setFeatureUsage] = useState<FeatureUsageConfig | undefined>(initial?.featureUsage);
  const [quotaUpdatedAt, setQuotaUpdatedAt] = useState("");
  const [spending, setSpending] = useState<SpendingDraft>(() => spendingDraftFromRule(initialRule(initial?.budget, scope, targetId)));
  const [searchDraft, setSearchDraft] = useState<FeatureDraft>(() => featureDraftFrom(initial?.featureUsage, scope, targetId, "search_provider_calls"));
  const [researchDraft, setResearchDraft] = useState<FeatureDraft>(() => featureDraftFrom(initial?.featureUsage, scope, targetId, "deep_research_runs"));
  const [loading, setLoading] = useState(!initial);
  const [saving, setSaving] = useState<"spending" | MeteredFeature | null>(null);
  const [error, setError] = useState("");

  const applyBudget = useCallback((next: BudgetDocument) => {
    setBudget(next);
    setSpending(spendingDraftFromRule(initialRule(next, scope, targetId)));
  }, [scope, targetId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [budgetRes, quotaRes] = await Promise.all([
        adminFetch("/api/metering/budget", { cache: "no-store" }),
        adminFetch("/api/metering/quota", { cache: "no-store" }),
      ]);
      const budgetJson = (await budgetRes.json()) as BudgetEnvelope;
      const quotaJson = (await quotaRes.json()) as QuotaEnvelope;
      if (!budgetRes.ok || budgetJson.code !== "00000" || !budgetJson.data?.budget) {
        throw new Error(budgetJson.message || t("loadFailed"));
      }
      if (!quotaRes.ok || quotaJson.code !== "00000" || !quotaJson.data?.quota) {
        throw new Error(quotaJson.message || t("loadFailed"));
      }
      applyBudget(budgetJson.data.budget);
      setFeatureUsage(quotaJson.data.quota.featureUsage);
      setQuotaUpdatedAt(quotaJson.data.quota.updatedAt ?? "");
      setSearchDraft(featureDraftFrom(quotaJson.data.quota.featureUsage, scope, targetId, "search_provider_calls"));
      setResearchDraft(featureDraftFrom(quotaJson.data.quota.featureUsage, scope, targetId, "deep_research_runs"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [applyBudget, scope, t, targetId]);

  useEffect(() => {
    if (initial) return;
    void load();
  }, [initial, load]);

  const saveSpending = async () => {
    if (!budget || saving) return;
    if (scope !== "defaults" && !targetId) {
      setError(t("missingTarget"));
      return;
    }
    if (spending.enabled && !(Number(spending.limit) > 0)) {
      setError(t("needLimit"));
      return;
    }
    setSaving("spending");
    setError("");
    try {
      const response = await adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(budgetSaveBody({ scope, id: targetId, current: budget, draft: spending })),
      });
      const json = (await response.json()) as BudgetEnvelope;
      if (response.status === 409) throw new Error(t("conflict"));
      if (!response.ok || json.code !== "00000" || !json.data?.budget) throw new Error(json.message || t("saveFailed"));
      applyBudget(json.data.budget);
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"));
    } finally {
      setSaving(null);
    }
  };

  const saveFeature = async (feature: MeteredFeature) => {
    if (!quotaUpdatedAt || saving) return;
    if (scope !== "defaults" && !targetId) {
      setError(t("missingTarget"));
      return;
    }
    const draft = feature === "search_provider_calls" ? searchDraft : researchDraft;
    setSaving(feature);
    setError("");
    try {
      const response = await adminFetch("/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(featureSaveBody({
          scope,
          id: targetId,
          updatedAt: quotaUpdatedAt,
          current: featureUsage,
          feature,
          values: featureEnabled(draft) ? featureValues(draft) : {},
        })),
      });
      const json = (await response.json()) as QuotaEnvelope;
      if (response.status === 409) throw new Error(t("conflict"));
      if (!response.ok || json.code !== "00000" || !json.data?.quota?.updatedAt) throw new Error(json.message || t("saveFailed"));
      setFeatureUsage(json.data.quota.featureUsage);
      setQuotaUpdatedAt(json.data.quota.updatedAt);
      const refreshed = featureDraftFrom(json.data.quota.featureUsage, scope, targetId, feature);
      if (feature === "search_provider_calls") setSearchDraft(refreshed);
      else setResearchDraft(refreshed);
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"));
    } finally {
      setSaving(null);
    }
  };

  const locked = fixedSpendingAction(scope);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{t(`${copy}.title`)}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`${copy}.description`)}</p>
      </div>
      {loading ? <Skeleton className="h-64 w-full" /> : (
        <Tabs defaultValue="spending">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="spending">{t("tabs.spending")}</TabsTrigger>
            <TabsTrigger value="search">{t("tabs.search")}</TabsTrigger>
            <TabsTrigger value="research">{t("tabs.research")}</TabsTrigger>
          </TabsList>
          <TabsContent value="spending" className="space-y-4 pt-3">
            <SpendingFields
              draft={spending}
              locked={locked}
              disabled={saving !== null}
              onChange={setSpending}
            />
            <div className="flex justify-end">
              <Button size="sm" disabled={!budget || saving !== null} onClick={() => void saveSpending()}>
                {saving === "spending" ? t("saving") : t("save")}
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="search" className="pt-3">
            <FeatureFields
              feature="search_provider_calls"
              draft={searchDraft}
              shared={scope === "departments"}
              disabled={saving !== null}
              onChange={setSearchDraft}
              onSave={() => void saveFeature("search_provider_calls")}
              saving={saving === "search_provider_calls"}
              canSave={Boolean(quotaUpdatedAt)}
            />
          </TabsContent>
          <TabsContent value="research" className="pt-3">
            <FeatureFields
              feature="deep_research_runs"
              draft={researchDraft}
              shared={scope === "departments"}
              disabled={saving !== null}
              onChange={setResearchDraft}
              onSave={() => void saveFeature("deep_research_runs")}
              saving={saving === "deep_research_runs"}
              canSave={Boolean(quotaUpdatedAt)}
            />
          </TabsContent>
        </Tabs>
      )}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>{t("reload")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function initialRule(budget: BudgetDocument | undefined, scope: LimitScope, id: string): SpendingRule | undefined {
  if (!budget) return undefined;
  if (scope === "defaults") return budget.defaults;
  return budget[scope]?.[id];
}

function SpendingFields({
  draft,
  locked,
  disabled,
  onChange,
}: {
  draft: SpendingDraft;
  locked: boolean;
  disabled: boolean;
  onChange: (draft: SpendingDraft) => void;
}) {
  const t = useTranslations("pages.iam.limits");
  const set = (patch: Partial<SpendingDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <p className="text-sm font-medium">{t("enable")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("inherit")}</p>
        </div>
        <Switch checked={draft.enabled} disabled={disabled} onCheckedChange={(enabled) => set({ enabled })} aria-label={t("enable")} />
      </div>
      {draft.enabled ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={draft.unit === "tokens"}
              disabled={disabled}
              onClick={() => onChange(selectSpendingUnit(draft, "tokens"))}
              className={`rounded-xl border p-3 text-left text-sm ${draft.unit === "tokens" ? "border-primary bg-primary/5" : "border-border"}`}
            >
              {t("unitTokens")}
            </button>
            <button
              type="button"
              aria-pressed={draft.unit === "cost_usd"}
              disabled={disabled}
              onClick={() => onChange(selectSpendingUnit(draft, "cost_usd"))}
              className={`rounded-xl border p-3 text-left text-sm ${draft.unit === "cost_usd" ? "border-primary bg-primary/5" : "border-border"}`}
            >
              {t("unitCost")}
            </button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("exclusive")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("period")}</Label>
              <Select value={draft.period} disabled={disabled} onValueChange={(period) => set({ period: period as SpendingDraft["period"] })}>
                <SelectTrigger aria-label={t("period")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t("periodDay")}</SelectItem>
                  <SelectItem value="week">{t("periodWeek")}</SelectItem>
                  <SelectItem value="month">{t("periodMonth")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit-value">{t("amount")}</Label>
              <Input
                id="limit-value"
                type="number"
                min="0"
                step={draft.unit === "tokens" ? "1" : "0.01"}
                value={String(draft.limit)}
                disabled={disabled}
                onChange={(event) => set({ limit: Number(event.target.value || 0) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit-warning">{t("warning")}</Label>
              <Input
                id="limit-warning"
                type="number"
                min="0"
                max="100"
                value={String(draft.warnThresholdPct)}
                disabled={disabled}
                onChange={(event) => set({ warnThresholdPct: Number(event.target.value || 0) })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("action")}</Label>
              {locked ? (
                <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">{t("actionBlock")}</p>
              ) : (
                <Select value={draft.action} disabled={disabled} onValueChange={(action) => set({ action: action as SpendingAction })}>
                  <SelectTrigger aria-label={t("action")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="block">{t("actionBlock")}</SelectItem>
                    <SelectItem value="warn">{t("actionWarn")}</SelectItem>
                    <SelectItem value="fallback">{t("actionFallback")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            {!locked && draft.action === "fallback" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="limit-fallback">{t("fallbackModel")}</Label>
                <Input
                  id="limit-fallback"
                  value={draft.fallbackModel ?? ""}
                  disabled={disabled}
                  onChange={(event) => set({ fallbackModel: event.target.value })}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function FeatureFields({
  feature,
  draft,
  shared,
  disabled,
  saving,
  canSave,
  onChange,
  onSave,
}: {
  feature: MeteredFeature;
  draft: FeatureDraft;
  shared: boolean;
  disabled: boolean;
  saving: boolean;
  canSave: boolean;
  onChange: (draft: FeatureDraft) => void;
  onSave: () => void;
}) {
  const t = useTranslations("pages.iam.limits");
  const enabled = featureEnabled(draft);
  const unit = feature === "search_provider_calls" ? t("calls") : t("runs");
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <p className="text-sm font-medium">{feature === "search_provider_calls" ? t("tabs.search") : t("tabs.research")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{shared ? t("sharedCount") : t("personalCount")}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled}
          aria-label={t("enable")}
          onCheckedChange={(on) => onChange(on ? { ...draft, month: draft.month || "0" } : { ...EMPTY_FEATURE })}
        />
      </div>
      {enabled ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURE_USAGE_WINDOWS.map((window) => (
            <div key={window} className="space-y-2">
              <Label htmlFor={`${feature}-${window}`}>{t(`window.${window}`)}</Label>
              <Input
                id={`${feature}-${window}`}
                type="number"
                min="0"
                step="1"
                disabled={disabled}
                value={draft[window]}
                placeholder={unit}
                onChange={(event) => onChange({ ...draft, [window]: event.target.value })}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button size="sm" disabled={!canSave || disabled} onClick={onSave}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}

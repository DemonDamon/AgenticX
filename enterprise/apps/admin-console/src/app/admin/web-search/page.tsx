"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { FeatureAssignmentCard } from "../../../components/assignment/FeatureAssignmentCard";
import {
  Badge,
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
  Switch,
  toast,
} from "@agenticx/ui";
import { ArrowRight, Globe2, KeyRound, Plus, RefreshCcw, Trash2 } from "lucide-react";

import { adminFetch } from "../../../lib/admin-client-auth";
import { orderSearchProvidersByRole } from "./provider-roles";

const MAX_PROVIDER_POOL_SIZE = 2;
const SEARCH_CALL_OPTIONS = [1, 2, 3, 4, 5] as const;
const DEEP_RESEARCH_PROVIDER_CALL_OPTIONS = [6, 12, 18, 24, 32, 40, 48, 60] as const;
const MAX_DAILY_SEARCH_PROVIDER_CALLS = 1_000_000;

function isValidDailyLimit(draft: string): boolean {
  const value = Number(draft.trim());
  return (
    draft.trim() !== "" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DAILY_SEARCH_PROVIDER_CALLS
  );
}

type PublicSearchProvider = {
  id: string;
  adapter: string;
  displayName: string;
  enabled: boolean;
  priority: number;
  hasApiKey: boolean;
  endpoint?: string;
};

type PublicSearchAdapter = {
  id: string;
  displayName: string;
  requiresApiKey: boolean;
  supportsCustomEndpoint?: boolean;
  defaultEndpoint?: string;
};

type DailyProviderQuota = {
  usageDay: string;
  limit: number;
  used: number;
  remaining: number | null;
  unlimited: boolean;
};

type WebSearchConfig = {
  enabled: boolean;
  provider: string;
  primaryProviderId: string;
  deepResearchEnabled: boolean;
  calculatorEnabled: boolean;
  maxSearchCalls: number;
  maxDeepResearchProviderCalls: number;
  dailyProviderQuota: DailyProviderQuota;
  providers: PublicSearchProvider[];
  availableAdapters: PublicSearchAdapter[];
};

type SearchProviderUpdate = Omit<PublicSearchProvider, "hasApiKey" | "endpoint"> & {
  apiKey?: string;
  options?: Record<string, unknown>;
};

function createProviderId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `search-provider-${crypto.randomUUID()}`;
  }
  return `search-provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function providerUpdates(
  providers: PublicSearchProvider[],
  keyUpdates: Record<string, string | undefined> = {},
): SearchProviderUpdate[] {
  return providers.map(({ hasApiKey: _hasApiKey, endpoint, ...provider }, priority) => ({
    ...provider,
    priority,
    ...(Object.prototype.hasOwnProperty.call(keyUpdates, provider.id)
      ? { apiKey: keyUpdates[provider.id] }
      : {}),
    ...(endpoint ? { options: { endpoint } } : {}),
  }));
}

function isSupportedEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export default function WebSearchSettingsPage() {
  const t = useTranslations("pages.admin.webSearch");
  const tc = useTranslations("common");
  const [config, setConfig] = useState<WebSearchConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [newAdapter, setNewAdapter] = useState("");
  const [newName, setNewName] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [dailyLimitDraft, setDailyLimitDraft] = useState("");

  const selectedAdapter = useMemo(
    () => config?.availableAdapters.find((adapter) => adapter.id === newAdapter),
    [config?.availableAdapters, newAdapter],
  );
  const orderedProviders = useMemo(
    () =>
      config
        ? orderSearchProvidersByRole(config.providers, config.primaryProviderId)
        : [],
    [config],
  );

  const load = async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/web-search", { cache: "no-store" });
      const payload = (await response.json()) as {
        data?: WebSearchConfig;
        message?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message ?? t("toast.loadFailed"));
      }
      setConfig(payload.data);
      setKeyDrafts({});
      setDailyLimitDraft(String(payload.data.dailyProviderQuota?.limit ?? 0));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const response = await adminFetch("/api/admin/web-search", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as {
        data?: WebSearchConfig;
        message?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message ?? t("toast.saveFailed"));
      }
      setConfig(payload.data);
      setDailyLimitDraft(String(payload.data.dailyProviderQuota?.limit ?? 0));
      toast.success(t("toast.saved"));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const selectPrimary = (providerId: string) => {
    if (!config) return;
    const ordered = orderSearchProvidersByRole(config.providers, providerId);
    if (ordered[0]?.id !== providerId) return;
    void save({ provider: providerId, providers: providerUpdates(ordered) });
  };

  const updateProviderKey = async (providerId: string, apiKey: string) => {
    if (!config) return;
    const saved = await save({
      provider: config.primaryProviderId,
      providers: providerUpdates(orderedProviders, { [providerId]: apiKey }),
    });
    if (saved) {
      setKeyDrafts((current) => ({ ...current, [providerId]: "" }));
    }
  };

  const removeProvider = (providerId: string) => {
    if (!config || config.providers.length <= 1) return;
    const next = orderedProviders.filter((provider) => provider.id !== providerId);
    const nextPrimary =
      config.primaryProviderId === providerId
        ? next[0]?.id
        : config.primaryProviderId;
    void save({
      provider: nextPrimary,
      providers: providerUpdates(next),
    });
  };

  const addProvider = async () => {
    if (!config || !selectedAdapter || config.providers.length >= MAX_PROVIDER_POOL_SIZE) return;
    const endpoint = newEndpoint.trim();
    if (endpoint && !isSupportedEndpoint(endpoint)) return;
    if (selectedAdapter.requiresApiKey && !newApiKey.trim()) return;

    const id = createProviderId();
    const nextProvider: PublicSearchProvider = {
      id,
      adapter: selectedAdapter.id,
      displayName: newName.trim() || selectedAdapter.displayName,
      enabled: true,
      priority: config.providers.length,
      hasApiKey: Boolean(newApiKey.trim()),
      ...(endpoint ? { endpoint } : {}),
    };
    const next = [...orderedProviders, nextProvider];
    const saved = await save({
      provider: orderedProviders[0]?.id || id,
      providers: providerUpdates(next, { [id]: newApiKey.trim() }),
    });
    if (saved) {
      setNewAdapter("");
      setNewName("");
      setNewEndpoint("");
      setNewApiKey("");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {tc("actions.refresh")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-5 w-5" />
            {t("policyTitle")}
          </CardTitle>
          <CardDescription>{t("policyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>{t("enabled")}</Label>
              <p className="text-sm text-muted-foreground">{t("enabledHint")}</p>
            </div>
            <Switch
              checked={config?.enabled ?? false}
              disabled={!config || loading || saving}
              onCheckedChange={(enabled) => void save({ enabled })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>{t("deepResearch")}</Label>
              <p className="text-sm text-muted-foreground">{t("deepResearchHint")}</p>
            </div>
            <Switch
              checked={config?.deepResearchEnabled ?? false}
              disabled={!config || loading || saving}
              onCheckedChange={(deepResearchEnabled) => void save({ deepResearchEnabled })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>{t("calculator")}</Label>
              <p className="text-sm text-muted-foreground">{t("calculatorHint")}</p>
            </div>
            <Switch
              checked={config?.calculatorEnabled ?? false}
              disabled={!config || loading || saving}
              onCheckedChange={(calculatorEnabled) => void save({ calculatorEnabled })}
            />
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <Label>{t("maxSearchCalls")}</Label>
            <p className="text-sm text-muted-foreground">{t("maxSearchCallsHint")}</p>
            <Select
              value={String(config?.maxSearchCalls ?? 3)}
              disabled={!config || loading || saving}
              onValueChange={(value) => void save({ maxSearchCalls: Number(value) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_CALL_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <Label>{t("maxDeepResearchProviderCalls")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("maxDeepResearchProviderCallsHint")}
            </p>
            <Select
              value={String(config?.maxDeepResearchProviderCalls ?? 24)}
              disabled={!config || loading || saving}
              onValueChange={(value) =>
                void save({ maxDeepResearchProviderCalls: Number(value) })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEEP_RESEARCH_PROVIDER_CALL_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <Label htmlFor="daily-search-provider-limit">
              {t("maxDailySearchProviderCalls")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("maxDailySearchProviderCallsHint")}
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="daily-search-provider-limit"
                type="number"
                min={0}
                max={MAX_DAILY_SEARCH_PROVIDER_CALLS}
                step={1}
                className="w-full"
                value={dailyLimitDraft}
                disabled={!config || loading || saving}
                onChange={(event) => setDailyLimitDraft(event.target.value)}
              />
              <Button
                variant="outline"
                disabled={!config || loading || saving || !isValidDailyLimit(dailyLimitDraft)}
                onClick={() =>
                  void save({ maxDailySearchProviderCalls: Number(dailyLimitDraft) })
                }
              >
                {t("saveDailySearchProviderLimit")}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {config?.dailyProviderQuota?.unlimited ?? true
                ? t("dailySearchProviderUsageUnlimited", {
                    used: config?.dailyProviderQuota?.used ?? 0,
                  })
                : t("dailySearchProviderUsage", {
                    used: config?.dailyProviderQuota?.used ?? 0,
                    limit: config?.dailyProviderQuota?.limit ?? 0,
                  })}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t("servicesTitle")}
          </CardTitle>
          <CardDescription>{t("servicesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : config ? (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm">
                <Badge variant="success">{t("primary")}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t("failoverCondition")}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline">{t("fallback")}</Badge>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {([0, 1] as const).map((slotIndex) => {
                  const provider = orderedProviders[slotIndex];
                  const isPrimary = slotIndex === 0;
                  const draft = provider ? keyDrafts[provider.id] ?? "" : "";
                  return (
                    <div
                      key={isPrimary ? "primary-provider" : "fallback-provider"}
                      className={[
                        "space-y-4 rounded-xl border p-4",
                        isPrimary
                          ? "border-primary/30 bg-primary/[0.035]"
                          : "border-border bg-muted/20",
                      ].join(" ")}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background text-xs font-semibold shadow-sm ring-1 ring-border">
                              {slotIndex + 1}
                            </span>
                            <span className="font-semibold">
                              {isPrimary
                                ? t("primaryProviderTitle")
                                : t("fallbackProviderTitle")}
                            </span>
                            <Badge variant={isPrimary ? "success" : "outline"}>
                              {isPrimary ? t("primary") : t("fallback")}
                            </Badge>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {isPrimary
                              ? t("primaryProviderHint")
                              : t("fallbackProviderHint")}
                          </p>
                        </div>
                        {provider ? (
                          <div className="flex gap-2">
                            {!isPrimary ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={saving}
                                onClick={() => selectPrimary(provider.id)}
                              >
                                {t("setPrimary")}
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive"
                              disabled={saving || config.providers.length <= 1}
                              aria-label={t("remove")}
                              onClick={() => removeProvider(provider.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {provider ? (
                        <>
                          <div className="rounded-lg border bg-background/80 px-3 py-2.5">
                            <div className="font-medium">{provider.displayName}</div>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {provider.adapter}
                              {provider.endpoint ? ` · ${provider.endpoint}` : ""}
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              type="password"
                              value={draft}
                              disabled={saving}
                              placeholder={
                                provider.hasApiKey
                                  ? t("keyConfigured")
                                  : t("keyPlaceholder")
                              }
                              onChange={(event) =>
                                setKeyDrafts((current) => ({
                                  ...current,
                                  [provider.id]: event.target.value,
                                }))
                              }
                            />
                            <Button
                              size="sm"
                              disabled={saving || !draft.trim()}
                              onClick={() =>
                                void updateProviderKey(provider.id, draft.trim())
                              }
                            >
                              {t("saveKey")}
                            </Button>
                            {provider.hasApiKey ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={saving}
                                onClick={() => void updateProviderKey(provider.id, "")}
                              >
                                {t("clearKey")}
                              </Button>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-dashed bg-background/50 px-4 py-8 text-center text-sm text-muted-foreground">
                          {isPrimary ? t("primaryEmpty") : t("fallbackEmpty")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              {t("emptyServices")}
            </div>
          )}

          <div className="space-y-4 rounded-lg border border-dashed p-4">
            <div className="flex items-center gap-2 font-medium">
              <Plus className="h-4 w-4" />
              {t(config?.providers.length ? "addFallbackService" : "addPrimaryService")}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("protocol")}</Label>
                <Select value={newAdapter} disabled={!config || saving || (config?.providers.length ?? 0) >= MAX_PROVIDER_POOL_SIZE} onValueChange={setNewAdapter}>
                  <SelectTrigger><SelectValue placeholder={t("selectProtocol")} /></SelectTrigger>
                  <SelectContent>
                    {config?.availableAdapters.map((adapter) => (
                      <SelectItem key={adapter.id} value={adapter.id}>{adapter.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("serviceName")}</Label>
                <Input value={newName} disabled={!selectedAdapter || saving} placeholder={selectedAdapter?.displayName ?? t("serviceNamePlaceholder")} onChange={(event) => setNewName(event.target.value)} />
              </div>
              {selectedAdapter?.supportsCustomEndpoint ? (
                <div className="space-y-1.5 md:col-span-2">
                  <Label>{t("endpoint")}</Label>
                  <Input value={newEndpoint} disabled={saving} placeholder={selectedAdapter.defaultEndpoint ?? "https://search.example.com/api"} onChange={(event) => setNewEndpoint(event.target.value)} />
                  {newEndpoint.trim() && !isSupportedEndpoint(newEndpoint.trim()) ? (
                    <p className="text-xs text-destructive">{t("invalidEndpoint")}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("apiKey")}</Label>
                <Input type="password" value={newApiKey} disabled={!selectedAdapter || saving} placeholder={selectedAdapter?.requiresApiKey ? t("keyRequired") : t("keyOptional")} onChange={(event) => setNewApiKey(event.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={
                  !config ||
                  saving ||
                  !selectedAdapter ||
                  config.providers.length >= MAX_PROVIDER_POOL_SIZE ||
                  (selectedAdapter.requiresApiKey && !newApiKey.trim()) ||
                  Boolean(newEndpoint.trim() && !isSupportedEndpoint(newEndpoint.trim()))
                }
                onClick={() => void addProvider()}
              >
                {t(config?.providers.length ? "addAsFallback" : "addAsPrimary")}
              </Button>
              {config && config.providers.length >= MAX_PROVIDER_POOL_SIZE ? (
                <span className="text-xs text-muted-foreground">{t("poolFull")}</span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <FeatureAssignmentCard feature="web_search" />
      <FeatureAssignmentCard feature="deep_research" />
    </div>
  );
}

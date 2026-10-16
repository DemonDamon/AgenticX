"use client";

import {
  BarCard,
  Button,
  Card,
  CardContent,
  LineCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  chartPalette,
} from "@agenticx/ui";
import { Activity, AlertTriangle, ArrowDownLeft, ArrowUpRight, Bot, Coins, Cpu, RefreshCcw, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../lib/admin-client-auth";
import type { RuntimeDashboard, RuntimeMetric } from "../lib/runtime-dashboard";

const EMPTY_METRIC: RuntimeMetric = { value: 0, previous: 0, delta_pct: 0 };
const ALL_VALUE = "__all__";

function formatCount(value: number, locale: string): string {
  if (locale.startsWith("zh")) {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
  }
  return value.toLocaleString(locale);
}

function deltaOf(metric: RuntimeMetric): { value: string; trend: "up" | "down" | "flat"; suffix: string } | undefined {
  if (metric.delta_pct === null) return undefined;
  const trend = metric.delta_pct > 0 ? "up" : metric.delta_pct < 0 ? "down" : "flat";
  return { value: Math.abs(metric.delta_pct).toFixed(1), trend, suffix: "%" };
}

export function RuntimeObserve() {
  const t = useTranslations("pages.dashboard.runtime");
  const locale = useLocale();
  const [data, setData] = useState<RuntimeDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState("");
  const [service, setService] = useState("");
  const [source, setSource] = useState("");
  const [trend, setTrend] = useState<"requests" | "errors">("requests");

  const hasActiveFilter = Boolean(userId || agentId || model || service || source);

  const resetFilters = () => {
    setUserId("");
    setAgentId("");
    setModel("");
    setService("");
    setSource("");
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams();
    if (userId) query.set("user_id", userId);
    if (agentId) query.set("agent_id", agentId);
    if (model) query.set("model", model);
    if (service) query.set("service", service);
    if (source) query.set("source", source);
    try {
      const response = await adminFetch(`/api/dashboard/runtime?${query.toString()}`, { cache: "no-store" });
      const json = (await response.json()) as { code?: string; message?: string; data?: RuntimeDashboard };
      if (!response.ok || json.code !== "00000" || !json.data) {
        throw new Error(json.message || t("loadFailed"));
      }
      setData(json.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [agentId, model, service, source, t, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = data?.cards;
  const compare = (metric: RuntimeMetric | undefined) => (metric?.delta_pct === null ? t("noBaseline") : t("versusPrevious"));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilter ? (
            <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t("filters.all")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className={loading ? "animate-spin" : undefined} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FilterSelect
          label={t("filters.userId")}
          value={userId}
          onChange={setUserId}
          allLabel={t("filters.all")}
          options={(data?.filters.users ?? []).map((user) => ({ value: user.id, label: user.id }))}
        />
        <FilterSelect
          label={t("filters.userName")}
          value={userId}
          onChange={setUserId}
          allLabel={t("filters.all")}
          options={(data?.filters.users ?? []).map((user) => ({ value: user.id, label: user.label }))}
        />
        <FilterSelect
          label={t("filters.agent")}
          value={agentId}
          onChange={setAgentId}
          allLabel={t("filters.all")}
          options={(data?.filters.agents ?? []).map((agent) => ({ value: agent.id, label: agent.label }))}
        />
        <FilterSelect
          label={t("filters.model")}
          value={model}
          onChange={setModel}
          allLabel={t("filters.all")}
          options={(data?.filters.models ?? []).map((item) => ({ value: item, label: item }))}
        />
        <FilterSelect
          label={t("filters.service")}
          value={service}
          onChange={setService}
          allLabel={t("filters.all")}
          options={(data?.filters.services ?? []).map((item) => ({ value: item, label: item }))}
        />
        <FilterSelect
          label={t("filters.source")}
          value={source}
          onChange={setSource}
          allLabel={t("filters.all")}
          options={[
            { value: "desktop", label: t("filters.desktop") },
            { value: "web", label: t("filters.web") },
          ]}
        />
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("cards.agents")}
          value={formatCount(cards?.agents.value ?? 0, locale)}
          icon={<Bot />}
          accentClassName="bg-primary"
          delta={cards ? deltaOf(cards.agents) : deltaOf(EMPTY_METRIC)}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.agents)} · {t("registered", { count: data?.registered_agents ?? 0 })}</span>}
        />
        <StatCard
          label={t("cards.requests")}
          value={formatCount(cards?.requests.value ?? 0, locale)}
          icon={<Activity />}
          accentClassName="bg-chart-2"
          delta={cards ? deltaOf(cards.requests) : undefined}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.requests)}</span>}
        />
        <StatCard
          label={t("cards.modelCalls")}
          value={formatCount(cards?.model_calls.value ?? 0, locale)}
          icon={<Cpu />}
          accentClassName="bg-chart-3"
          delta={cards ? deltaOf(cards.model_calls) : undefined}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.model_calls)}</span>}
        />
        <StatCard
          label={t("cards.modelErrors")}
          value={formatCount(cards?.model_errors.value ?? 0, locale)}
          icon={<AlertTriangle />}
          accentClassName="bg-danger"
          delta={cards ? deltaOf(cards.model_errors) : undefined}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.model_errors)}</span>}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("cards.inputTokens")}
          value={formatCount(cards?.input_tokens.value ?? 0, locale)}
          icon={<ArrowDownLeft />}
          delta={cards ? deltaOf(cards.input_tokens) : undefined}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.input_tokens)}</span>}
        />
        <StatCard
          label={t("cards.outputTokens")}
          value={formatCount(cards?.output_tokens.value ?? 0, locale)}
          icon={<ArrowUpRight />}
          delta={cards ? deltaOf(cards.output_tokens) : undefined}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.output_tokens)}</span>}
        />
        <StatCard
          label={t("cards.totalTokens")}
          value={formatCount(cards?.total_tokens.value ?? 0, locale)}
          icon={<Coins />}
          delta={cards ? deltaOf(cards.total_tokens) : undefined}
          footer={<span className="text-xs text-muted-foreground">{compare(cards?.total_tokens)}</span>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <LineCard
          title={t("charts.requestTrend")}
          description={t("charts.lastDay")}
          actions={
            <div className="flex gap-1">
              <Button type="button" size="sm" variant={trend === "requests" ? "default" : "outline"} onClick={() => setTrend("requests")}>{t("charts.requests")}</Button>
              <Button type="button" size="sm" variant={trend === "errors" ? "default" : "outline"} onClick={() => setTrend("errors")}>{t("charts.errors")}</Button>
            </div>
          }
          data={data?.request_trend ?? []}
          xKey="bucket"
          series={[{ key: trend, label: trend === "requests" ? t("charts.requests") : t("charts.errors"), color: trend === "requests" ? chartPalette[0] : chartPalette[3] }]}
          height={280}
          hideLegend
        />
        <LineCard
          title={t("charts.modelCallTrend")}
          description={t("charts.lastDay")}
          data={data?.model_call_trend ?? []}
          xKey="bucket"
          series={[{ key: "calls", label: t("charts.modelCalls"), color: chartPalette[0] }]}
          height={280}
          hideLegend
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BarCard
          title={t("charts.requestsByAgent")}
          description={t("charts.top10")}
          data={data?.requests_by_agent ?? []}
          xKey="name"
          series={[{ key: "requests", label: t("charts.requests"), color: chartPalette[0] }]}
          horizontal
          hideLegend
          height={320}
          emptyLabel={t("empty")}
        />
        <BarCard
          title={t("charts.callsByAgent")}
          description={t("charts.top10")}
          data={data?.calls_by_agent_model ?? []}
          xKey="name"
          series={[{ key: "calls", label: t("charts.modelCalls"), color: chartPalette[0] }]}
          horizontal
          hideLegend
          height={320}
          emptyLabel={t("empty")}
        />
        <BarCard
          title={t("charts.tokenBuckets")}
          description={t("charts.bucketHint")}
          data={data?.token_buckets ?? []}
          xKey="bucket"
          series={[{ key: "traces", label: t("charts.requests"), color: chartPalette[0] }]}
          hideLegend
          height={320}
          emptyLabel={t("empty")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <LineCard
          title={t("charts.modelErrors")}
          description={t("charts.lastDay")}
          data={data?.model_error_trend ?? []}
          xKey="bucket"
          series={[{ key: "errors", label: t("charts.errors"), color: chartPalette[3] }]}
          height={280}
          hideLegend
        />
        <BarCard
          title={t("charts.tokensByModel")}
          description={t("charts.top10")}
          data={data?.tokens_by_model ?? []}
          xKey="name"
          series={[{ key: "tokens", label: t("cards.totalTokens"), color: chartPalette[0] }]}
          horizontal
          hideLegend
          height={280}
          emptyLabel={t("empty")}
        />
        <BarCard
          title={t("charts.tpsByModel")}
          description={t("charts.tpsHint")}
          data={data?.tps_by_model ?? []}
          xKey="name"
          series={[{ key: "tps", label: t("charts.tps"), color: chartPalette[0] }]}
          horizontal
          hideLegend
          height={280}
          emptyLabel={t("empty")}
        />
      </div>
      {loading && !data ? <Card><CardContent className="py-6 text-sm text-muted-foreground">{t("loading")}</CardContent></Card> : null}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value || ALL_VALUE} onValueChange={(next) => onChange(next === ALL_VALUE ? "" : next)}>
        <SelectTrigger className="h-9 w-full bg-background/60">
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

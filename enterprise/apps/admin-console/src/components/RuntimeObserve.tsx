"use client";

import { BarCard, Button, Card, CardContent, LineCard, StatCard, chartPalette } from "@agenticx/ui";
import { Bot, Coins, Cpu, RefreshCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { adminFetch } from "../lib/admin-client-auth";
import type { RuntimeDashboard, RuntimeMetric } from "../lib/runtime-dashboard";

const EMPTY_METRIC: RuntimeMetric = { value: 0, previous: 0, delta_pct: 0 };

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
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCcw />
          {t("refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect label={t("filters.userId")} value={userId} onChange={setUserId} allLabel={t("filters.all")}>
          {(data?.filters.users ?? []).map((user) => (
            <option key={user.id} value={user.id}>{user.id}</option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("filters.userName")} value={userId} onChange={setUserId} allLabel={t("filters.all")}>
          {(data?.filters.users ?? []).map((user) => (
            <option key={user.id} value={user.id}>{user.label}</option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("filters.agent")} value={agentId} onChange={setAgentId} allLabel={t("filters.all")}>
          {(data?.filters.agents ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.label}</option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("filters.model")} value={model} onChange={setModel} allLabel={t("filters.all")}>
          {(data?.filters.models ?? []).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("filters.service")} value={service} onChange={setService} allLabel={t("filters.all")}>
          {(data?.filters.services ?? []).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("filters.source")} value={source} onChange={setSource} allLabel={t("filters.all")}>
          <option value="desktop">{t("filters.desktop")}</option>
          <option value="web">{t("filters.web")}</option>
        </FilterSelect>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label={t("cards.agents")} value={formatCount(cards?.agents.value ?? 0, locale)} icon={<Bot />} delta={cards ? deltaOf(cards.agents) : deltaOf(EMPTY_METRIC)} footer={<span className="text-xs text-muted-foreground">{compare(cards?.agents)} · {t("registered", { count: data?.registered_agents ?? 0 })}</span>} />
        <StatCard label={t("cards.requests")} value={formatCount(cards?.requests.value ?? 0, locale)} icon={<Cpu />} delta={cards ? deltaOf(cards.requests) : undefined} footer={<span className="text-xs text-muted-foreground">{compare(cards?.requests)}</span>} />
        <StatCard label={t("cards.modelCalls")} value={formatCount(cards?.model_calls.value ?? 0, locale)} icon={<Cpu />} delta={cards ? deltaOf(cards.model_calls) : undefined} footer={<span className="text-xs text-muted-foreground">{compare(cards?.model_calls)}</span>} />
        <StatCard label={t("cards.inputTokens")} value={formatCount(cards?.input_tokens.value ?? 0, locale)} icon={<Coins />} delta={cards ? deltaOf(cards.input_tokens) : undefined} footer={<span className="text-xs text-muted-foreground">{compare(cards?.input_tokens)}</span>} />
        <StatCard label={t("cards.outputTokens")} value={formatCount(cards?.output_tokens.value ?? 0, locale)} icon={<Coins />} delta={cards ? deltaOf(cards.output_tokens) : undefined} footer={<span className="text-xs text-muted-foreground">{compare(cards?.output_tokens)}</span>} />
        <StatCard label={t("cards.totalTokens")} value={formatCount(cards?.total_tokens.value ?? 0, locale)} icon={<Coins />} delta={cards ? deltaOf(cards.total_tokens) : undefined} footer={<span className="text-xs text-muted-foreground">{compare(cards?.total_tokens)}</span>} />
        <StatCard label={t("cards.modelErrors")} value={formatCount(cards?.model_errors.value ?? 0, locale)} icon={<Cpu />} delta={cards ? deltaOf(cards.model_errors) : undefined} footer={<span className="text-xs text-muted-foreground">{compare(cards?.model_errors)}</span>} />
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
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {label}
      <select
        className="h-9 rounded-md border border-border bg-card px-2 pr-8 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {children}
      </select>
    </label>
  );
}

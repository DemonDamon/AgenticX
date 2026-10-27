"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";
import {
  displayStatusKey,
  formatDuration,
  formatLocalDateTime,
  MA_RANGE_VALUES,
  MA_SESSION_SOURCES,
  MA_SESSION_STATUSES,
  MA_STOP_REASONS,
  type DurationUnits,
  type MaRange,
} from "../../lib/ma-session-console";

type Filters = {
  agentId: string;
  userEmail: string;
  status: string;
  source: string;
  range: MaRange;
};

type AgentOption = { id: string; displayName: string; slug: string };

type SessionUser = { id: string; email: string; displayName: string } | null;

type SessionItem = {
  id: string;
  title: string | null;
  agentId: string;
  agentName: string | null;
  agentVersion: number;
  source: string;
  status: string;
  stopReason: { type?: unknown } | null;
  user: SessionUser;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    tool_calls: number;
    runtime_ms: number;
  };
  createdAt: string;
};

const DEFAULT_FILTERS: Filters = {
  agentId: "",
  userEmail: "",
  status: "",
  source: "",
  range: "7d",
};

export default function ManagedSessionsPanel({ reloadToken = 0 }: { reloadToken?: number }) {
  const t = useTranslations("pages.ops.managedSessions");
  const locale = useLocale();
  const router = useRouter();
  const units: DurationUnits = { ms: t("units.ms"), s: t("units.s"), m: t("units.m") };
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminFetch("/api/admin/ma-sessions/agents")
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = await readData<{ agents: AgentOption[] }>(res);
        if (!cancelled) setAgents(data.agents);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    void adminFetch(`/api/admin/ma-sessions?${buildQuery(applied)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          setItems([]);
          setNextBeforeId(null);
          return;
        }
        const data = await readData<{ items: SessionItem[]; nextBeforeId: string | null }>(res);
        if (cancelled) return;
        setItems(data.items);
        setNextBeforeId(data.nextBeforeId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (errorStatus(err) === 403) {
          setForbidden(true);
          setItems([]);
          setNextBeforeId(null);
          return;
        }
        setError(err instanceof Error ? err.message : "");
        setItems([]);
        setNextBeforeId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied, reloadToken]);

  async function loadMore() {
    if (!nextBeforeId || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await readData<{ items: SessionItem[]; nextBeforeId: string | null }>(
        await adminFetch(`/api/admin/ma-sessions?${buildQuery(applied, nextBeforeId)}`),
      );
      setItems((current) => [...current, ...data.items]);
      setNextBeforeId(data.nextBeforeId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FilterField label={t("filters.agent")}>
          <Select
            value={draft.agentId || "all"}
            onValueChange={(value) => setDraft((current) => ({ ...current, agentId: value === "all" ? "" : value }))}
          >
            <SelectTrigger className="w-[12rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allAgents")}</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.displayName || agent.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label={t("filters.userEmail")}>
          <Input
            value={draft.userEmail}
            className="h-9 w-[14rem]"
            onChange={(event) => setDraft((current) => ({ ...current, userEmail: event.target.value }))}
          />
        </FilterField>
        <FilterField label={t("filters.status")}>
          <Select
            value={draft.status || "all"}
            onValueChange={(value) => setDraft((current) => ({ ...current, status: value === "all" ? "" : value }))}
          >
            <SelectTrigger className="w-[9rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allStatus")}</SelectItem>
              {MA_SESSION_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label={t("filters.source")}>
          <Select
            value={draft.source || "all"}
            onValueChange={(value) => setDraft((current) => ({ ...current, source: value === "all" ? "" : value }))}
          >
            <SelectTrigger className="w-[9rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allSources")}</SelectItem>
              {MA_SESSION_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {t(`source.${source}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label={t("filters.range")}>
          <Select
            value={draft.range}
            onValueChange={(value) => {
              if (isRange(value)) setDraft((current) => ({ ...current, range: value }));
            }}
          >
            <SelectTrigger className="w-[9rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MA_RANGE_VALUES.map((range) => (
                <SelectItem key={range} value={range}>
                  {rangeLabel(range, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <div className="flex gap-2">
          <Button type="button" onClick={() => setApplied({ ...draft })}>
            {t("filters.apply")}
          </Button>
          <Button type="button" variant="outline" onClick={() => {
            setDraft({ ...DEFAULT_FILTERS });
            setApplied({ ...DEFAULT_FILTERS });
          }}>
            {t("filters.reset")}
          </Button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="mb-3 text-sm text-muted-foreground">{t("loading")}</p> : null}
      {forbidden ? <EmptyState title={t("forbidden")} /> : null}
      {!forbidden && !loading && !error && items.length === 0 ? <EmptyState title={t("empty")} /> : null}
      {!forbidden && items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.session")}</TableHead>
                <TableHead>{t("columns.agent")}</TableHead>
                <TableHead>{t("columns.user")}</TableHead>
                <TableHead>{t("columns.source")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.tokens")}</TableHead>
                <TableHead>{t("columns.toolCalls")}</TableHead>
                <TableHead>{t("columns.runtime")}</TableHead>
                <TableHead>{t("columns.createdAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const statusKey = displayStatusKey(item.status, item.stopReason);
                const stopType = item.status === "idle" && typeof item.stopReason?.type === "string" ? item.stopReason.type : null;
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/ops/logs/managed/${item.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">{item.title?.trim() ? item.title : t("untitled")}</div>
                      <div className="font-mono text-xs text-muted-foreground" title={item.id}>
                        {item.id.slice(0, 10)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.agentName ? `${item.agentName} · v${item.agentVersion}` : item.agentId.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <div>{item.user?.displayName ? item.user.displayName : t("unknownUser")}</div>
                      {item.user?.email ? <div className="text-xs text-muted-foreground">{item.user.email}</div> : null}
                    </TableCell>
                    <TableCell>{sourceLabel(item.source, t)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={badgeVariant(statusKey)}>{statusLabel(statusKey, t)}</Badge>
                        {stopType ? <span className="text-xs text-muted-foreground">{stopLabel(stopType, t)}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatCount(item.usage.input_tokens, locale)} / {formatCount(item.usage.output_tokens, locale)}
                    </TableCell>
                    <TableCell>{formatCount(item.usage.tool_calls, locale)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDuration(item.usage.runtime_ms, units)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatLocalDateTime(item.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {!forbidden && nextBeforeId ? (
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t("loading") : t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </label>
  );
}

function buildQuery(filters: Filters, beforeId?: string): string {
  const params = new URLSearchParams();
  if (filters.agentId) params.set("agent_id", filters.agentId);
  const email = filters.userEmail.trim();
  if (email) params.set("user_email", email);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  params.set("range", filters.range);
  if (beforeId) params.set("before_id", beforeId);
  return params.toString();
}

function isRange(value: string): value is MaRange {
  return (MA_RANGE_VALUES as readonly string[]).includes(value);
}

type Translator = ReturnType<typeof useTranslations>;

function rangeLabel(range: MaRange, t: Translator): string {
  switch (range) {
    case "1d":
      return t("filters.range1d");
    case "7d":
      return t("filters.range7d");
    case "30d":
      return t("filters.range30d");
    case "all":
      return t("filters.rangeAll");
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

function statusLabel(key: string, t: Translator): string {
  switch (key) {
    case "idle":
    case "running":
    case "rescheduling":
    case "terminated":
    case "archived":
    case "requiresAction":
      return t(`status.${key}`);
    default:
      return key;
  }
}

function sourceLabel(source: string, t: Translator): string {
  if ((MA_SESSION_SOURCES as readonly string[]).includes(source)) return t(`source.${source}`);
  return source;
}

function stopLabel(type: string, t: Translator): string {
  if ((MA_STOP_REASONS as readonly string[]).includes(type)) return t(`stopReason.${type}`);
  return type;
}

function badgeVariant(key: string): "info" | "warning" | "destructive" | "outline" | "soft" {
  switch (key) {
    case "running":
      return "info";
    case "rescheduling":
    case "requiresAction":
      return "warning";
    case "terminated":
      return "destructive";
    case "archived":
      return "outline";
    case "idle":
      return "soft";
    default:
      return "outline";
  }
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

async function readData<T>(res: Response): Promise<T> {
  let body: { message?: string; data?: T } = {};
  try {
    body = (await res.json()) as { message?: string; data?: T };
  } catch {
    body = {};
  }
  if (!res.ok || body.data === undefined) {
    const error = new Error(body.message || "") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return body.data;
}

function errorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: number }).status);
    return Number.isFinite(status) ? status : 0;
  }
  return 0;
}

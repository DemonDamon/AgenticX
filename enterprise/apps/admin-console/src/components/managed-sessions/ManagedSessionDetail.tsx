"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent, EmptyState, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";
import {
  buildReplayTimeline,
  displayStatusKey,
  formatDuration,
  formatLocalDateTime,
  IMPLICIT_LOCAL_ENVIRONMENT_ID,
  MAX_REPLAY_EVENTS,
  MA_SESSION_SOURCES,
  MA_STOP_REASONS,
  type DurationUnits,
} from "../../lib/ma-session-console";
import { SessionReplayTimeline } from "./SessionReplayTimeline";

type SessionUser = { id: string; email: string; displayName: string } | null;

type SessionDetail = {
  id: string;
  title: string | null;
  agentId: string;
  agentName: string | null;
  agentVersion: number;
  environmentId: string | null;
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
  updatedAt: string;
};

type WorkItem = {
  id: string;
  status: string;
  claimedByDevice: string | null;
  claimedAt: string | null;
  lastHeartbeatAt: string | null;
  completedAt: string | null;
  error: string | null;
};

type EventRow = { seq: number; event: Record<string, unknown> };

export function ManagedSessionDetail({ sessionId }: { sessionId: string }) {
  const t = useTranslations("pages.ops.managedSessions");
  const locale = useLocale();
  const units: DurationUnits = { ms: t("units.ms"), s: t("units.s"), m: t("units.m") };
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pullEvents = useCallback(async (start: number, existing: EventRow[]) => {
    const collected = [...existing];
    const cap = existing.length + MAX_REPLAY_EVENTS;
    let after = start;
    while (collected.length < cap) {
      const page = await readData<{ items: EventRow[]; nextAfterSeq: number | null }>(
        await adminFetch(`/api/admin/ma-sessions/${encodeURIComponent(sessionId)}/events?after_seq=${after}&limit=500`),
      );
      const rows = normalizeEvents(page.items);
      collected.push(...rows);
      if (page.nextAfterSeq == null || rows.length === 0 || page.nextAfterSeq <= after) {
        return { events: collected, cursor: page.nextAfterSeq ?? after, truncated: false };
      }
      after = page.nextAfterSeq;
      if (collected.length >= cap) return { events: collected, cursor: after, truncated: true };
    }
    return { events: collected, cursor: after, truncated: collected.length >= cap };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setForbidden(false);
    setError(null);
    setSession(null);
    setEvents([]);
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/ma-sessions/${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const data = await readData<{ session: SessionDetail; workItems: WorkItem[] }>(res);
        if (cancelled) return;
        setSession(data.session);
        setWorkItems(Array.isArray(data.workItems) ? data.workItems : []);
        const pulled = await pullEvents(0, []);
        if (cancelled) return;
        setEvents(pulled.events);
        setCursor(pulled.cursor);
        setTruncated(pulled.truncated);
      } catch (err: unknown) {
        if (cancelled) return;
        if (errorStatus(err) === 404) setNotFound(true);
        else if (errorStatus(err) === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pullEvents, sessionId]);

  async function loadMoreEvents() {
    if (loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const pulled = await pullEvents(cursor, events);
      setEvents(pulled.events);
      setCursor(pulled.cursor);
      setTruncated(pulled.truncated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setLoadingMore(false);
    }
  }

  const statusKey = session ? displayStatusKey(session.status, session.stopReason) : "";
  const stopType = session && session.status === "idle" && typeof session.stopReason?.type === "string" ? session.stopReason.type : null;

  return (
    <div>
      <Button variant="link" size="sm" className="mb-3 px-0" asChild>
        <Link href="/ops/logs?tab=managed">{t("detail.back")}</Link>
      </Button>
      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      {notFound ? <EmptyState title={t("detail.notFound")} /> : null}
      {forbidden ? <EmptyState title={t("forbidden")} /> : null}
      {session ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{session.title?.trim() ? session.title : t("untitled")}</h1>
            <Badge variant={badgeVariant(statusKey)}>{statusLabel(statusKey, t)}</Badge>
            {stopType ? <span className="text-xs text-muted-foreground">{stopLabel(stopType, t)}</span> : null}
          </div>
          <section>
            <h2 className="mb-3 text-sm font-medium text-foreground">{t("detail.summary")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Fact label={t("columns.agent")} value={session.agentName ? `${session.agentName} · v${session.agentVersion}` : session.agentId.slice(0, 10)} />
              <Fact label={t("columns.user")} value={session.user?.displayName ? `${session.user.displayName}${session.user.email ? ` · ${session.user.email}` : ""}` : t("unknownUser")} />
              <Fact label={t("columns.source")} value={sourceLabel(session.source, t)} />
              <Fact
                label={t("detail.environment")}
                value={session.environmentId === IMPLICIT_LOCAL_ENVIRONMENT_ID ? t("defaultEnvironment") : session.environmentId || "—"}
              />
              <Fact label={t("detail.createdAt")} value={formatLocalDateTime(session.createdAt)} />
              <Fact label={t("detail.updatedAt")} value={formatLocalDateTime(session.updatedAt)} />
              <StatCard label={t("detail.inputTokens")} value={formatCount(session.usage.input_tokens, locale)} />
              <StatCard label={t("detail.outputTokens")} value={formatCount(session.usage.output_tokens, locale)} />
              <StatCard label={t("detail.cacheTokens")} value={formatCount(session.usage.cache_read_input_tokens, locale)} />
              <StatCard label={t("detail.toolCalls")} value={formatCount(session.usage.tool_calls, locale)} />
              <StatCard label={t("detail.runtime")} value={formatDuration(session.usage.runtime_ms, units)} />
            </div>
          </section>
          {workItems.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-medium text-foreground">{t("detail.workItems")}</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("workItem.status")}</TableHead>
                      <TableHead>{t("workItem.device")}</TableHead>
                      <TableHead>{t("workItem.claimedAt")}</TableHead>
                      <TableHead>{t("workItem.heartbeat")}</TableHead>
                      <TableHead>{t("workItem.completedAt")}</TableHead>
                      <TableHead>{t("workItem.error")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{workStatusLabel(item.status, t)}</TableCell>
                        <TableCell>{item.claimedByDevice || "—"}</TableCell>
                        <TableCell>{item.claimedAt ? formatLocalDateTime(item.claimedAt) : "—"}</TableCell>
                        <TableCell>{item.lastHeartbeatAt ? formatLocalDateTime(item.lastHeartbeatAt) : "—"}</TableCell>
                        <TableCell>{item.completedAt ? formatLocalDateTime(item.completedAt) : "—"}</TableCell>
                        <TableCell className={item.error ? "text-destructive" : "text-muted-foreground"}>{item.error || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-medium text-foreground">{t("detail.timeline")}</h2>
              {truncated ? <span className="text-sm text-muted-foreground">{t("detail.truncated")}</span> : null}
              {truncated ? (
                <Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadMoreEvents()}>
                  {loadingMore ? t("loading") : t("detail.loadMoreEvents")}
                </Button>
              ) : null}
            </div>
            <SessionReplayTimeline items={buildReplayTimeline(events.map((row) => row.event))} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 break-all text-sm font-medium text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

type Translator = ReturnType<typeof useTranslations>;

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

function workStatusLabel(status: string, t: Translator): string {
  switch (status) {
    case "queued":
    case "claimed":
    case "running":
    case "completed":
    case "failed":
    case "stopped":
      return t(`workItem.${status}`);
    default:
      return status;
  }
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

function normalizeEvents(items: EventRow[] | undefined): EventRow[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const event = item.event && typeof item.event === "object" ? item.event : {};
    const seq = typeof item.seq === "number" && Number.isFinite(item.seq) ? item.seq : 0;
    return { seq, event };
  });
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

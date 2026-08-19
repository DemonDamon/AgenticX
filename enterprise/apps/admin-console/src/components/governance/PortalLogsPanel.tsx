"use client";

import { adminFetch } from "../../lib/admin-client-auth";
import { TraceTimelineInline } from "../../components/trace-timeline-tree";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from "@agenticx/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, ExternalLink, FileText, Inbox, RefreshCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PortalLogItem } from "../../lib/portal-logs-query";
import type { PortalSessionRollup } from "../../lib/portal-logs-session-query";

type QueryResult = {
  total: number;
  items: PortalLogItem[];
};

type SessionQueryResult = {
  total: number;
  items: PortalSessionRollup[];
  ungrouped_count: number;
};

type LevelFilter = "all" | "warn+" | "error";
type GroupBy = "request" | "session";

const ROUTE_FILTER_OPTIONS = [
  "",
  "chat.completions",
  "deep_research.runs",
  "deep_research.stream",
  "deep_research.resume",
] as const;

type RouteFilter = (typeof ROUTE_FILTER_OPTIONS)[number];

const MODE_FILTER_OPTIONS = ["", "chat", "deep_research", "web_search"] as const;
type ModeFilter = (typeof MODE_FILTER_OPTIONS)[number];

function levelBadgeVariant(level: string): "destructive" | "warning" | "secondary" {
  if (level === "error") return "destructive";
  if (level === "warn") return "warning";
  return "secondary";
}

function modeBadgeVariant(mode: string | null): "default" | "secondary" {
  return mode === "deep_research" ? "default" : "secondary";
}

function modeLabel(
  mode: string | null,
  t: (key: string) => string,
): string {
  if (mode === "deep_research") return t("modeDeepResearch");
  if (mode === "web_search") return t("modeWebSearch");
  return t("modeChat");
}

function PortalLogsPageContent() {
  const t = useTranslations("pages.ops.portalLogs");
  const tRuntime = useTranslations("pages.ops.traceRuntime");
  const ts = useTranslations("shell");
  const searchParams = useSearchParams();
  const initialTrace = searchParams.get("trace_id")?.trim() ?? "";

  const [items, setItems] = useState<PortalLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sessionItems, setSessionItems] = useState<PortalSessionRollup[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [selected, setSelected] = useState<PortalLogItem | null>(null);
  const [selectedSession, setSelectedSession] = useState<PortalSessionRollup | null>(null);
  const [sessionTurns, setSessionTurns] = useState<PortalLogItem[]>([]);
  const [sessionTurnsLoading, setSessionTurnsLoading] = useState(false);
  const [sessionTurnTraceId, setSessionTurnTraceId] = useState<string | null>(null);
  const [traceId, setTraceId] = useState(initialTrace);
  const [sessionId, setSessionId] = useState(searchParams.get("session_id")?.trim() ?? "");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("request");
  const [mode, setMode] = useState<ModeFilter>("");
  const [route, setRoute] = useState<RouteFilter>("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const fromQuery = searchParams.get("trace_id")?.trim() ?? "";
    if (fromQuery) setTraceId(fromQuery);
    const sessionFromQuery = searchParams.get("session_id")?.trim() ?? "";
    if (sessionFromQuery) setSessionId(sessionFromQuery);
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    try {
      if (groupBy === "session") {
        const response = await adminFetch("/api/portal-logs/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId || undefined,
            level: level === "all" ? undefined : level,
            mode: mode || undefined,
            route: route || undefined,
            start: start ? new Date(start).toISOString() : undefined,
            end: end ? new Date(end).toISOString() : undefined,
            limit: 100,
          }),
        });
        if (response.status === 401 || response.status === 403) {
          setForbidden(true);
          setSessionItems([]);
          setSessionTotal(0);
          setUngroupedCount(0);
          return;
        }
        const payload = (await response.json()) as {
          code?: string;
          data?: SessionQueryResult;
          message?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? t("toast.loadFailed"));
        }
        setSessionItems(payload.data?.items ?? []);
        setSessionTotal(payload.data?.total ?? 0);
        setUngroupedCount(payload.data?.ungrouped_count ?? 0);
        setItems([]);
        setTotal(0);
        return;
      }

      const response = await adminFetch("/api/portal-logs/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trace_id: traceId || undefined,
          session_id: sessionId || undefined,
          level: level === "all" ? undefined : level,
          mode: mode || undefined,
          route: route || undefined,
          start: start ? new Date(start).toISOString() : undefined,
          end: end ? new Date(end).toISOString() : undefined,
          limit: 100,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        setItems([]);
        setTotal(0);
        return;
      }
      const payload = (await response.json()) as {
        code?: string;
        data?: QueryResult;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? t("toast.loadFailed"));
      }
      setItems(payload.data?.items ?? []);
      setTotal(payload.data?.total ?? 0);
      setSessionItems([]);
      setSessionTotal(0);
      setUngroupedCount(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [groupBy, traceId, sessionId, level, mode, route, start, end, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<PortalLogItem>[]>(
    () => [
      {
        accessorKey: "log_time",
        header: t("columns.time"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.log_time}</span>
        ),
      },
      {
        accessorKey: "level",
        header: t("columns.level"),
        cell: ({ row }) => (
          <Badge variant={levelBadgeVariant(row.original.level)}>{row.original.level}</Badge>
        ),
      },
      {
        accessorKey: "event",
        header: t("columns.event"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.event}</span>,
      },
      {
        accessorKey: "mode",
        header: t("columns.mode"),
        cell: ({ row }) => (
          <Badge variant={modeBadgeVariant(row.original.mode)}>
            {modeLabel(row.original.mode, t)}
          </Badge>
        ),
      },
      {
        accessorKey: "route",
        header: t("columns.route"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.route ?? "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: t("columns.status"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.status ?? "—"}</span>
        ),
      },
      {
        accessorKey: "duration_ms",
        header: t("columns.duration"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.duration_ms != null ? `${row.original.duration_ms}ms` : "—"}
          </span>
        ),
      },
      {
        accessorKey: "user_id",
        header: t("columns.user"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.user_id ?? "—"}</span>
        ),
      },
    ],
    [t],
  );

  const sessionColumns = useMemo<ColumnDef<PortalSessionRollup>[]>(
    () => [
      {
        accessorKey: "session_id",
        header: t("columns.sessionId"),
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <span className="max-w-[220px] truncate font-mono text-xs">
              {row.original.session_id}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard.writeText(row.original.session_id).then(() => {
                  toast.success(t("toast.copiedSession"));
                });
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        ),
      },
      {
        accessorKey: "turns",
        header: t("columns.turns"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.turns}</span>
        ),
      },
      {
        id: "modes",
        header: t("columns.mode"),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.modes.length > 0
              ? row.original.modes.map((m) => (
                  <Badge key={m} variant={modeBadgeVariant(m)}>
                    {modeLabel(m, t)}
                  </Badge>
                ))
              : "—"}
          </div>
        ),
      },
      {
        accessorKey: "total_duration_ms",
        header: t("columns.duration"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.total_duration_ms != null
              ? `${row.original.total_duration_ms}ms`
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "error_count",
        header: t("columns.errorCount"),
        cell: ({ row }) =>
          row.original.error_count > 0 ? (
            <Badge variant="destructive">{row.original.error_count}</Badge>
          ) : (
            <span className="font-mono text-xs">0</span>
          ),
      },
      {
        accessorKey: "last_time",
        header: t("columns.lastActive"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.last_time}</span>
        ),
      },
      {
        accessorKey: "user_id",
        header: t("columns.user"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.user_id ?? "—"}</span>
        ),
      },
    ],
    [t],
  );

  const openSession = useCallback(
    async (session: PortalSessionRollup) => {
      setSelected(null);
      setSelectedSession(session);
      setSessionTurnTraceId(null);
      setSessionTurns([]);
      setSessionTurnsLoading(true);
      try {
        const response = await adminFetch("/api/portal-logs/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: session.session_id,
            limit: 100,
          }),
        });
        const payload = (await response.json()) as {
          data?: QueryResult;
          message?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? t("toast.loadFailed"));
        }
        setSessionTurns(payload.data?.items ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
      } finally {
        setSessionTurnsLoading(false);
      }
    },
    [t],
  );

  const displayTotal = groupBy === "session" ? sessionTotal : total;
  const listEmpty =
    groupBy === "session" ? sessionItems.length === 0 : items.length === 0;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">{ts("nav.groups.ops")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("breadcrumb")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>


      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
          <div className="min-w-0 space-y-1.5 xl:col-span-4">
            <Label htmlFor="portal-log-trace">{t("filterTraceId")}</Label>
            <Input
              id="portal-log-trace"
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder={t("filterTraceIdPlaceholder")}
              className="font-mono"
              disabled={groupBy === "session"}
            />
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-4">
            <Label htmlFor="portal-log-session">{t("filterSessionId")}</Label>
            <Input
              id="portal-log-session"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder={t("filterSessionIdPlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-2">
            <Label>{t("filterLevel")}</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as LevelFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("levelAll")}</SelectItem>
                <SelectItem value="warn+">{t("levelWarnPlus")}</SelectItem>
                <SelectItem value="error">{t("levelError")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-2">
            <Label>{t("groupByLabel")}</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="request">{t("groupByRequest")}</SelectItem>
                <SelectItem value="session">{t("groupBySession")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-2">
            <Label>{t("filterMode")}</Label>
            <Select
              value={mode === "" ? "__all__" : mode}
              onValueChange={(v) => setMode(v === "__all__" ? "" : (v as ModeFilter))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("modeAll")}</SelectItem>
                <SelectItem value="chat">{t("modeChat")}</SelectItem>
                <SelectItem value="deep_research">{t("modeDeepResearch")}</SelectItem>
                <SelectItem value="web_search">{t("modeWebSearch")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-3">
            <Label>{t("filterRoute")}</Label>
            <Select
              value={route === "" ? "__all__" : route}
              onValueChange={(v) => setRoute(v === "__all__" ? "" : (v as RouteFilter))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("routeAll")}</SelectItem>
                <SelectItem value="chat.completions">chat.completions</SelectItem>
                <SelectItem value="deep_research.runs">deep_research.runs</SelectItem>
                <SelectItem value="deep_research.stream">deep_research.stream</SelectItem>
                <SelectItem value="deep_research.resume">deep_research.resume</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-3">
            <Label htmlFor="portal-log-start">{t("filterStart")}</Label>
            <Input
              id="portal-log-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="min-w-0"
            />
          </div>
          <div className="min-w-0 space-y-1.5 xl:col-span-3">
            <Label htmlFor="portal-log-end">{t("filterEnd")}</Label>
            <Input
              id="portal-log-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="min-w-0"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-9 w-full sm:w-auto xl:col-span-1 xl:w-full"
            onClick={() => void load()}
            disabled={loading}
          >
            <Search className="mr-1.5 h-3.5 w-3.5" />
            {t("applyFilters")}
          </Button>
        </CardContent>
      </Card>

      {groupBy === "session" && !start && !end ? (
        <p className="text-xs text-muted-foreground">{t("sessionWindowHint")}</p>
      ) : null}
      {groupBy === "session" && ungroupedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("ungroupedHint", { count: ungroupedCount })}
        </p>
      ) : null}

      {forbidden ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("forbiddenTitle")}
          description={t("forbiddenDescription")}
        />
      ) : loading && listEmpty ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t("emptyLoadingTitle")}
          description={t("emptyLoadingDescription")}
        />
      ) : listEmpty ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : groupBy === "session" ? (
        <DataTable
          columns={sessionColumns}
          data={sessionItems}
          onRowClick={(row) => void openSession(row.original)}
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          onRowClick={(row) => {
            setSelectedSession(null);
            setSelected(row.original);
          }}
        />
      )}

      <Sheet
        open={!!selectedSession}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSession(null);
            setSessionTurnTraceId(null);
            setSessionTurns([]);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-[90vw]">
          {selectedSession ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-sm">{selectedSession.session_id}</SheetTitle>
                <SheetDescription>
                  {t("columns.turns")}: {selectedSession.turns} · {selectedSession.last_time}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedSession.modes.map((m) => (
                    <Badge key={m} variant={modeBadgeVariant(m)}>
                      {modeLabel(m, t)}
                    </Badge>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(selectedSession.session_id)
                        .then(() => toast.success(t("toast.copiedSession")));
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("detail.copySessionId")}
                  </Button>
                </div>
                <dl className="divide-y divide-border">
                  <DetailRow label={t("columns.turns")} value={selectedSession.turns} />
                  <DetailRow
                    label={t("columns.duration")}
                    value={
                      selectedSession.total_duration_ms != null
                        ? `${selectedSession.total_duration_ms}ms`
                        : "—"
                    }
                  />
                  <DetailRow label={t("columns.errorCount")} value={selectedSession.error_count} />
                  <DetailRow label={t("detail.user")} value={selectedSession.user_id ?? "—"} />
                </dl>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("sessionTurnsTitle")}
                  </div>
                  {sessionTurnsLoading ? (
                    <p className="text-xs text-muted-foreground">{t("sessionTurnsLoading")}</p>
                  ) : sessionTurns.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("sessionTurnsEmpty")}</p>
                  ) : (
                    <div className="space-y-2">
                      {sessionTurns.map((turn) => (
                        <div
                          key={turn.id}
                          className="rounded-md border border-border p-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {turn.log_time}
                            </span>
                            <Badge variant={modeBadgeVariant(turn.mode)}>
                              {modeLabel(turn.mode, t)}
                            </Badge>
                            <span className="font-mono text-xs">{turn.status ?? "—"}</span>
                            <span className="font-mono text-xs">
                              {turn.duration_ms != null ? `${turn.duration_ms}ms` : "—"}
                            </span>
                            {turn.trace_id ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="ml-auto h-7"
                                onClick={() => setSessionTurnTraceId(turn.trace_id)}
                              >
                                {t("detail.viewRuntime")}
                              </Button>
                            ) : null}
                          </div>
                          {turn.trace_id ? (
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {turn.trace_id}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {sessionTurnTraceId ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("detail.runtimeProcess")}
                    </div>
                    <TraceTimelineInline
                      traceId={sessionTurnTraceId}
                      labels={{
                        loading: tRuntime("loading"),
                        empty: tRuntime("emptyDescription"),
                        loadFailed: tRuntime("toast.loadFailed"),
                        expand: tRuntime("expand"),
                        collapse: tRuntime("collapse"),
                        kind: (kind) => tRuntime(`kind.${kind}`),
                        totalsSteps: tRuntime("totals.steps"),
                        totalsTokens: tRuntime("totals.tokens"),
                        totalsDuration: tRuntime("totals.duration"),
                        detailTitle: tRuntime("detail.title"),
                        contentTitle: tRuntime("detail.contentTitle"),
                        metadataTitle: tRuntime("detail.metadataTitle"),
                        selectHint: tRuntime("detail.selectHint"),
                        close: tRuntime("detail.close"),
                        status: tRuntime("detail.status"),
                        duration: tRuntime("detail.duration"),
                        tokens: tRuntime("detail.tokens"),
                        cost: tRuntime("detail.cost"),
                        startedAt: tRuntime("detail.startedAt"),
                        stage: tRuntime("detail.stage"),
                        errorMessage: tRuntime("detail.errorMessage"),
                        ioTitle: tRuntime("detail.ioTitle"),
                        ioPrompt: tRuntime("detail.ioPrompt"),
                        ioCompletion: tRuntime("detail.ioCompletion"),
                        noStepIo: tRuntime("detail.noStepIo"),
                        attributes: tRuntime("detail.attributes"),
                        sources: tRuntime("detail.sources"),
                        emptyAttrs: tRuntime("detail.emptyAttrs"),
                        conversation: {
                          title: tRuntime("conversation.title"),
                          titleSession: tRuntime("conversation.titleSession"),
                          loading: tRuntime("conversation.loading"),
                          empty: tRuntime("conversation.empty"),
                          loadFailed: tRuntime("conversation.loadFailed"),
                          expand: tRuntime("conversation.expand"),
                          collapse: tRuntime("conversation.collapse"),
                          truncatedHint: tRuntime("conversation.truncatedHint"),
                          roleUser: tRuntime("conversation.roleUser"),
                          roleAssistant: tRuntime("conversation.roleAssistant"),
                          roleTool: tRuntime("conversation.roleTool"),
                          roleSystem: tRuntime("conversation.roleSystem"),
                          reasoning: tRuntime("conversation.reasoning"),
                          reasoningExpand: tRuntime("conversation.reasoningExpand"),
                          reasoningCollapse: tRuntime("conversation.reasoningCollapse"),
                          attachments: tRuntime("conversation.attachments"),
                          chars: tRuntime("conversation.chars"),
                          scopeTurn: tRuntime("conversation.scopeTurn"),
                          scopeSession: tRuntime("conversation.scopeSession"),
                          loadEarlier: tRuntime("conversation.loadEarlier"),
                          noSession: tRuntime("conversation.noSession"),
                        },
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-[90vw]">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-sm">{selected.event}</SheetTitle>
                <SheetDescription>{selected.log_time}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={levelBadgeVariant(selected.level)}>{selected.level}</Badge>
                  {selected.trace_id ? (
                    <>
                      <span className="font-mono text-xs">{selected.trace_id}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => {
                          void navigator.clipboard.writeText(selected.trace_id ?? "").then(() => {
                            toast.success(t("toast.copied"));
                          });
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t("detail.copyRequestId")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7" asChild>
                        <Link href={`/audit?trace_id=${encodeURIComponent(selected.trace_id)}`}>
                          {t("detail.viewAudit")}
                        </Link>
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7" asChild>
                        <Link href={`/traces/${encodeURIComponent(selected.trace_id)}`}>
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          {t("detail.openRuntimePage")}
                        </Link>
                      </Button>
                    </>
                  ) : null}
                </div>

                <dl className="divide-y divide-border">
                  <DetailRow label={t("detail.route")} value={selected.route ?? "—"} />
                  <DetailRow label={t("columns.mode")} value={modeLabel(selected.mode, t)} />
                  {selected.run_id ? (
                    <DetailRow label={t("detail.runId")} value={selected.run_id} />
                  ) : null}
                  <DetailRow label={t("detail.status")} value={selected.status ?? "—"} />
                  <DetailRow
                    label={t("detail.duration")}
                    value={selected.duration_ms != null ? `${selected.duration_ms}ms` : "—"}
                  />
                  <DetailRow label={t("detail.user")} value={selected.user_id ?? "—"} />
                  <DetailRow label={t("detail.session")} value={selected.session_id ?? "—"} />
                </dl>

                {selected.trace_id ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("detail.runtimeProcess")}
                    </div>
                    <TraceTimelineInline
                      traceId={selected.trace_id}
                      labels={{
                        loading: tRuntime("loading"),
                        empty: tRuntime("emptyDescription"),
                        loadFailed: tRuntime("toast.loadFailed"),
                        expand: tRuntime("expand"),
                        collapse: tRuntime("collapse"),
                        kind: (kind) => tRuntime(`kind.${kind}`),
                        totalsSteps: tRuntime("totals.steps"),
                        totalsTokens: tRuntime("totals.tokens"),
                        totalsDuration: tRuntime("totals.duration"),
                        detailTitle: tRuntime("detail.title"),
                        contentTitle: tRuntime("detail.contentTitle"),
                        metadataTitle: tRuntime("detail.metadataTitle"),
                        selectHint: tRuntime("detail.selectHint"),
                        close: tRuntime("detail.close"),
                        status: tRuntime("detail.status"),
                        duration: tRuntime("detail.duration"),
                        tokens: tRuntime("detail.tokens"),
                        cost: tRuntime("detail.cost"),
                        startedAt: tRuntime("detail.startedAt"),
                        stage: tRuntime("detail.stage"),
                        errorMessage: tRuntime("detail.errorMessage"),
                        ioTitle: tRuntime("detail.ioTitle"),
                        ioPrompt: tRuntime("detail.ioPrompt"),
                        ioCompletion: tRuntime("detail.ioCompletion"),
                        noStepIo: tRuntime("detail.noStepIo"),
                        attributes: tRuntime("detail.attributes"),
                        sources: tRuntime("detail.sources"),
                        emptyAttrs: tRuntime("detail.emptyAttrs"),
                        conversation: {
                          title: tRuntime("conversation.title"),
                          titleSession: tRuntime("conversation.titleSession"),
                          loading: tRuntime("conversation.loading"),
                          empty: tRuntime("conversation.empty"),
                          loadFailed: tRuntime("conversation.loadFailed"),
                          expand: tRuntime("conversation.expand"),
                          collapse: tRuntime("conversation.collapse"),
                          truncatedHint: tRuntime("conversation.truncatedHint"),
                          roleUser: tRuntime("conversation.roleUser"),
                          roleAssistant: tRuntime("conversation.roleAssistant"),
                          roleTool: tRuntime("conversation.roleTool"),
                          roleSystem: tRuntime("conversation.roleSystem"),
                          reasoning: tRuntime("conversation.reasoning"),
                          reasoningExpand: tRuntime("conversation.reasoningExpand"),
                          reasoningCollapse: tRuntime("conversation.reasoningCollapse"),
                          attachments: tRuntime("conversation.attachments"),
                          chars: tRuntime("conversation.chars"),
                          scopeTurn: tRuntime("conversation.scopeTurn"),
                          scopeSession: tRuntime("conversation.scopeSession"),
                          loadEarlier: tRuntime("conversation.loadEarlier"),
                          noSession: tRuntime("conversation.noSession"),
                        },
                      }}
                    />
                  </div>
                ) : null}

                {selected.error_message ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">{t("detail.errorMessage")}</div>
                    <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                      {selected.error_message}
                    </pre>
                  </div>
                ) : null}

                {selected.error_stack ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">{t("detail.errorStack")}</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                      {selected.error_stack}
                    </pre>
                  </div>
                ) : null}

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground">{t("detail.fields")}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(JSON.stringify(selected.fields ?? {}, null, 2))
                          .then(() => toast.success(t("toast.copiedFields")));
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t("detail.copyFields")}
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                    {JSON.stringify(selected.fields ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs text-right">{value}</dd>
    </div>
  );
}

export function PortalLogsPanel() {
  const t = useTranslations("pages.ops.portalLogs");
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground">{t("emptyLoadingTitle")}</div>
      }
    >
      <PortalLogsPageContent />
    </Suspense>
  );
}

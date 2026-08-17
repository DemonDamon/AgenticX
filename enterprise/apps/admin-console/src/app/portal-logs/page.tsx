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
  PageHeader,
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

type QueryResult = {
  total: number;
  items: PortalLogItem[];
};

type LevelFilter = "all" | "warn+" | "error";

const ROUTE_FILTER_OPTIONS = [
  "",
  "chat.completions",
  "deep_research.runs",
  "deep_research.stream",
  "deep_research.resume",
] as const;

type RouteFilter = (typeof ROUTE_FILTER_OPTIONS)[number];

function levelBadgeVariant(level: string): "destructive" | "warning" | "secondary" {
  if (level === "error") return "destructive";
  if (level === "warn") return "warning";
  return "secondary";
}

function PortalLogsPageContent() {
  const t = useTranslations("pages.ops.portalLogs");
  const tRuntime = useTranslations("pages.ops.traceRuntime");
  const ts = useTranslations("shell");
  const searchParams = useSearchParams();
  const initialTrace = searchParams.get("trace_id")?.trim() ?? "";

  const [items, setItems] = useState<PortalLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PortalLogItem | null>(null);
  const [traceId, setTraceId] = useState(initialTrace);
  const [sessionId, setSessionId] = useState(searchParams.get("session_id")?.trim() ?? "");
  const [level, setLevel] = useState<LevelFilter>("all");
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
      const response = await adminFetch("/api/portal-logs/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trace_id: traceId || undefined,
          session_id: sessionId || undefined,
          level: level === "all" ? undefined : level,
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [traceId, sessionId, level, route, start, end, t]);

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

      <PageHeader
        title={t("title")}
        description={t("description", { count: total })}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("refresh")}
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="min-w-[280px] flex-1 space-y-1.5">
            <Label htmlFor="portal-log-trace">{t("filterTraceId")}</Label>
            <Input
              id="portal-log-trace"
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder={t("filterTraceIdPlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="min-w-[280px] flex-1 space-y-1.5">
            <Label htmlFor="portal-log-session">{t("filterSessionId")}</Label>
            <Input
              id="portal-log-session"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder={t("filterSessionIdPlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="w-[160px] space-y-1.5">
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
          <div className="w-[220px] space-y-1.5">
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
          <div className="w-[180px] space-y-1.5">
            <Label htmlFor="portal-log-start">{t("filterStart")}</Label>
            <Input
              id="portal-log-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="w-[180px] space-y-1.5">
            <Label htmlFor="portal-log-end">{t("filterEnd")}</Label>
            <Input
              id="portal-log-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <Button type="button" size="sm" onClick={() => void load()} disabled={loading}>
            <Search className="mr-1.5 h-3.5 w-3.5" />
            {t("applyFilters")}
          </Button>
        </CardContent>
      </Card>

      {forbidden ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("forbiddenTitle")}
          description={t("forbiddenDescription")}
        />
      ) : loading && items.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t("emptyLoadingTitle")}
          description={t("emptyLoadingDescription")}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          onRowClick={(row) => setSelected(row.original)}
        />
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-4xl overflow-y-auto">
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
                        selectHint: tRuntime("detail.selectHint"),
                        status: tRuntime("detail.status"),
                        duration: tRuntime("detail.duration"),
                        tokens: tRuntime("detail.tokens"),
                        cost: tRuntime("detail.cost"),
                        startedAt: tRuntime("detail.startedAt"),
                        attributes: tRuntime("detail.attributes"),
                        sources: tRuntime("detail.sources"),
                        emptyAttrs: tRuntime("detail.emptyAttrs"),
                        conversation: {
                          title: tRuntime("conversation.title"),
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
                          attachments: tRuntime("conversation.attachments"),
                          chars: tRuntime("conversation.chars"),
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

export default function PortalLogsPage() {
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

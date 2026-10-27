"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@agenticx/ui";
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  Cpu,
  Layers,
  RefreshCcw,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ConversationMarkdown } from "../../../components/conversation-md";

type TraceSpan = {
  step_no: number;
  step_kind: string;
  status: string;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: string;
  duration_ms: number;
  error_message: string | null;
  created_at?: string;
  metadata?: {
    tool_name?: string;
    subagent_name?: string;
    user_text?: string;
    reply?: string;
    thought?: string;
    parent_step_no?: number;
  } | null;
};

type TraceNode = {
  key: string;
  span: TraceSpan;
  children: TraceNode[];
};

function shortTraceId(id: string): string {
  const body = id.startsWith("near:") ? id.slice(5) : id;
  const splitAt = body.lastIndexOf(":");
  if (splitAt > 0) {
    const session = body.slice(0, splitAt);
    const run = body.slice(splitAt + 1);
    const sessionTail = session.length > 8 ? session.slice(-8) : session;
    const runHead = run.length > 8 ? run.slice(0, 8) : run;
    return `${sessionTail} · ${runHead}`;
  }
  if (id.length <= 22) return id;
  return `${id.slice(0, 10)}…${id.slice(-8)}`;
}

function metaText(span: TraceSpan, key: "user_text" | "reply" | "thought" | "tool_name" | "subagent_name"): string {
  const value = span.metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function parentStep(span: TraceSpan): number | null {
  const value = span.metadata?.parent_step_no;
  return typeof value === "number" ? value : null;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function traceParts(traceId: string): { session: string; run: string } {
  const body = traceId.startsWith("near:") ? traceId.slice(5) : traceId;
  const splitAt = body.lastIndexOf(":");
  if (splitAt <= 0) return { session: traceId, run: "" };
  return { session: body.slice(0, splitAt), run: body.slice(splitAt + 1) };
}

function buildTraceTree(spans: TraceSpan[]): TraceNode[] {
  const nodes = new Map<number, TraceNode>();
  for (const span of spans) nodes.set(span.step_no, { key: `step-${span.step_no}`, span, children: [] });
  const roots: TraceNode[] = [];
  const run = spans.find((span) => span.step_kind === "run");
  for (const span of spans) {
    const node = nodes.get(span.step_no);
    if (!node) continue;
    const parentNo = parentStep(span);
    const linked = parentNo != null ? nodes.get(parentNo) : undefined;
    if (linked && linked !== node) {
      linked.children.push(node);
      continue;
    }
    if (span.step_kind !== "run" && run) {
      const runNode = nodes.get(run.step_no);
      if (runNode && runNode !== node) {
        runNode.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  attachThoughts(roots);
  return roots;
}

function attachThoughts(nodes: TraceNode[]) {
  for (const node of nodes) {
    attachThoughts(node.children);
    const thought = metaText(node.span, "thought");
    if (node.span.step_kind !== "model" || !thought) continue;
    node.children.unshift({
      key: `thought-${node.span.step_no}`,
      span: { ...node.span, step_kind: "thought" },
      children: [],
    });
  }
}

function countNodes(nodes: TraceNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

function findNode(nodes: TraceNode[], key: string | null): TraceNode | null {
  if (!key) return null;
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findNode(node.children, key);
    if (child) return child;
  }
  return null;
}

function filterTreeNodes(nodes: TraceNode[], query: string): TraceNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: TraceNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTreeNodes(node.children, q);
    const hitSelf =
      node.span.step_kind.toLowerCase().includes(q) ||
      (node.span.model ?? "").toLowerCase().includes(q) ||
      metaText(node.span, "tool_name").toLowerCase().includes(q) ||
      metaText(node.span, "subagent_name").toLowerCase().includes(q);
    if (hitSelf || filteredChildren.length > 0) {
      out.push({ ...node, children: filteredChildren });
    }
  }
  return out;
}

type TraceDetail = {
  trace_id: string;
  status: string;
  spans: TraceSpan[];
  total_usage: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
};

type CenterTab = "overview" | "traces" | "sessions";

type ErrorKind = "tool" | "model" | "subagent" | "run";
type LedgerRange = "1d" | "7d" | "all";
type RangeValue = { min: string; max: string };
const EMPTY_RANGE: RangeValue = { min: "", max: "" };

function matchRange(value: number, range: RangeValue): boolean {
  const minText = range.min.trim();
  const maxText = range.max.trim();
  if (minText) {
    const min = Number(minText);
    if (Number.isFinite(min) && value < min) return false;
  }
  if (maxText) {
    const max = Number(maxText);
    if (Number.isFinite(max) && value > max) return false;
  }
  return true;
}

type TraceSummary = {
  trace_id: string;
  session_id: string;
  source: "desktop" | "web";
  status: string;
  started_at: string;
  duration_ms: number;
  model: string | null;
  operation: string;
  input_preview: string;
  output_preview?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens: number;
  cost_usd?: number;
  error_kind: ErrorKind | null;
  error_labels?: ErrorKind[];
};

type SpanObservation = {
  id: string;
  trace_id: string;
  session_id: string;
  status: string;
  step_kind: string;
  error_kind: ErrorKind | null;
  started_at: string;
  operation: string;
  model: string | null;
  input_preview: string;
  output_preview: string;
  duration_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens: number;
  cost_usd: number;
};

type SessionSummary = {
  session_id: string;
  source: "desktop" | "web";
  trace_count: number;
  started_at: string;
  duration_ms: number;
  models?: string[];
  input_tokens?: number;
  output_tokens?: number;
  total_tokens: number;
  cost_usd?: number;
  input_preview: string;
  output_preview?: string;
  status: string;
};

type ObservationOverview = {
  trace_count: number;
  error_count: number;
  model_calls: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p90_duration_ms: number;
  top_models: { model: string; calls: number; tokens: number; avg_duration_ms: number }[];
};

export function AgentTracesPage({
  embedded = false,
  section,
  onSection,
  reloadToken = 0,
}: {
  embedded?: boolean;
  section?: CenterTab;
  onSection?: (section: CenterTab) => void;
  reloadToken?: number;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const [internalTab, setInternalTab] = useState<CenterTab>(section ?? "overview");
  const tab = section ?? internalTab;
  const setTab = (next: CenterTab) => {
    setInternalTab(next);
    onSection?.(next);
  };
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [observations, setObservations] = useState<SpanObservation[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [overview, setOverview] = useState<ObservationOverview | null>(null);
  const [sessionFilter, setSessionFilter] = useState("");
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadIds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/agent-traces?catalog=1", { cache: "no-store" });
      const json = (await res.json()) as {
        data?: { traces?: TraceSummary[]; sessions?: SessionSummary[]; observations?: SpanObservation[]; overview?: ObservationOverview };
      };
      setTraces(json.data?.traces ?? []);
      setObservations(json.data?.observations ?? []);
      setSessions(json.data?.sessions ?? []);
      setOverview(json.data?.overview ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (traceId: string) => {
    if (!traceId.trim()) return;
    setLoading(true);
    try {
      const res = await adminFetch(`/api/agent-traces?trace_id=${encodeURIComponent(traceId)}`, { cache: "no-store" });
      if (!res.ok) {
        setDetail(null);
        return;
      }
      const json = (await res.json()) as { data?: TraceDetail };
      setDetail(json.data ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIds();
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("trace_id");
      if (param) {
        void loadDetail(param);
      }
    }
  }, [loadIds, loadDetail, reloadToken]);

  const activeSummary = useMemo(
    () => (detail ? traces.find((item) => item.trace_id === detail.trace_id) ?? null : null),
    [detail, traces]
  );

  const activeSession = useMemo(
    () => (selectedSessionId ? sessions.find((item) => item.session_id === selectedSessionId) ?? null : null),
    [selectedSessionId, sessions]
  );

  const activeSessionTraces = useMemo(
    () =>
      selectedSessionId
        ? traces
            .filter((item) => item.session_id === selectedSessionId)
            .sort((a, b) => a.started_at.localeCompare(b.started_at))
        : [],
    [selectedSessionId, traces]
  );

  return (
    <div className={embedded ? "flex flex-col gap-5 px-6 pt-4 pb-6" : "flex flex-col gap-6 p-6"}>
      {embedded ? null : (
        <PageHeader
          title={t("title")}
          description={t("description")}
          breadcrumb={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href="/ops/logs">{t("title")}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          actions={
            <Button variant="outline" size="sm" onClick={() => void loadIds()} disabled={loading}>
              <RefreshCcw className={loading ? "animate-spin" : undefined} />
              {t("refresh")}
            </Button>
          }
        />
      )}

      {embedded ? null : (
        <div className="flex gap-2">
          {(["overview", "traces", "sessions"] as const).map((item) => (
            <Button key={item} type="button" size="sm" variant={tab === item ? "default" : "outline"} onClick={() => { setTab(item); setDetail(null); }}>
              {t(`tabs.${item}`)}
            </Button>
          ))}
        </div>
      )}

      {tab === "overview" ? (
        <OverviewPanel overview={overview} />
      ) : tab === "sessions" ? (
        <SessionLedger
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onOpen={(sessionId) => setSelectedSessionId(sessionId)}
        />
      ) : (
        <TraceLedger
          traces={traces}
          observations={observations}
          selectedTraceId={detail?.trace_id ?? null}
          sessionFilter={sessionFilter}
          onClearSession={() => setSessionFilter("")}
          onOpen={(traceId) => void loadDetail(traceId)}
        />
      )}

      <Sheet open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[960px] lg:max-w-[1080px]">
          <SheetTitle className="sr-only">{t("traceDetail")}</SheetTitle>
          <SheetDescription className="sr-only">{t("traceDetailHint")}</SheetDescription>
          {detail ? (
            <TraceExplorer
              detail={detail}
              summary={activeSummary}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selectedSessionId && activeSession)} onOpenChange={(open) => { if (!open) setSelectedSessionId(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[960px] lg:max-w-[1080px]">
          <SheetTitle className="sr-only">{t("ledger.sessionDetail")}</SheetTitle>
          <SheetDescription className="sr-only">{t("traceDetailHint")}</SheetDescription>
          {activeSession ? (
            <SessionExplorer
              session={activeSession}
              sessionTraces={activeSessionTraces}
              onFilterInTraces={(sessionId) => {
                setSelectedSessionId(null);
                setSessionFilter(sessionId);
                setTab("traces");
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function OverviewPanel({ overview }: { overview: ObservationOverview | null }) {
  const t = useTranslations("pages.ops.agentTraces");
  if (!overview) return <EmptyState title={t("empty")} />;
  const cards = [
    [t("overview.traces"), String(overview.trace_count)],
    [t("overview.errors"), String(overview.error_count)],
    [t("overview.modelCalls"), String(overview.model_calls)],
    [t("overview.toolCalls"), String(overview.tool_calls)],
    [t("overview.tokens"), String(overview.total_tokens)],
    [t("overview.p50"), formatDuration(overview.p50_duration_ms)],
    [t("overview.p90"), formatDuration(overview.p90_duration_ms)],
    [t("overview.avg"), formatDuration(overview.avg_duration_ms)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("overview.topModels")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {overview.top_models.length === 0 ? <EmptyState title={t("empty")} /> : overview.top_models.map((row) => (
            <div key={row.model} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{row.model}</span>
              <span className="shrink-0 text-muted-foreground">{row.calls} · {row.tokens} tokens · {formatDuration(row.avg_duration_ms)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function withinRange(iso: string, range: LedgerRange, now: number): boolean {
  if (range === "all") return true;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  const windowMs = range === "1d" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return at >= now - windowMs;
}

function shortId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function errorText(kind: string | null, translate: (key: string) => string): string {
  if (kind === "tool") return translate("errors.tool");
  if (kind === "model") return translate("errors.model");
  if (kind === "subagent") return translate("errors.subagent");
  if (kind === "run") return translate("errors.run");
  return "—";
}

function StatusPill({ status }: { status: string }) {
  const ok = status === "ok";
  return (
    <span
      className={[
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide",
        ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
      ].join(" ")}
    >
      {ok ? "OK" : "ERROR"}
    </span>
  );
}

function ErrorTypeBadges({
  labels,
  translate,
}: {
  labels: ErrorKind[];
  translate: (key: string) => string;
}) {
  if (labels.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center rounded border border-danger/35 bg-danger-soft/50 px-1.5 py-0.5 text-[11px] font-medium text-danger">
        {errorText(labels[0] ?? null, translate)}
      </span>
      {labels.length > 1 ? (
        <span className="inline-flex items-center rounded border border-danger/35 bg-danger-soft/40 px-1 py-0.5 font-mono text-[10px] font-medium text-danger">
          +{labels.length - 1}
        </span>
      ) : null}
    </span>
  );
}

function TraceLedger({
  traces,
  observations,
  selectedTraceId,
  sessionFilter,
  onClearSession,
  onOpen,
}: {
  traces: TraceSummary[];
  observations: SpanObservation[];
  selectedTraceId: string | null;
  sessionFilter: string;
  onClearSession: () => void;
  onOpen: (traceId: string) => void;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const [mode, setMode] = useState<"traces" | "observations">("traces");
  const [range, setRange] = useState<LedgerRange>("1d");
  const [showOk, setShowOk] = useState(true);
  const [showError, setShowError] = useState(true);
  const [kinds, setKinds] = useState<Record<ErrorKind, boolean>>({
    tool: true,
    model: true,
    subagent: true,
    run: true,
  });
  const [keyword, setKeyword] = useState("");
  const [traceQuery, setTraceQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState(sessionFilter);
  const [durationRange, setDurationRange] = useState<RangeValue>(EMPTY_RANGE);
  const [inputTokenRange, setInputTokenRange] = useState<RangeValue>(EMPTY_RANGE);
  const [outputTokenRange, setOutputTokenRange] = useState<RangeValue>(EMPTY_RANGE);
  const [totalTokenRange, setTotalTokenRange] = useState<RangeValue>(EMPTY_RANGE);
  const [costRange, setCostRange] = useState<RangeValue>(EMPTY_RANGE);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    setSessionQuery(sessionFilter);
  }, [sessionFilter]);

  const now = Date.now();
  const inWindow = traces.filter((trace) => withinRange(trace.started_at, range, now));
  const labelsOf = (trace: TraceSummary): ErrorKind[] => (trace.error_labels ?? (trace.error_kind ? [trace.error_kind] : []));
  const kindCount = (kind: ErrorKind) => inWindow.filter((trace) => labelsOf(trace).includes(kind)).length;
  const q = keyword.trim().toLowerCase();
  const filteredTraces = inWindow.filter((trace) => {
    if (trace.status === "ok" && !showOk) return false;
    if (trace.status !== "ok" && !showError) return false;
    const present = labelsOf(trace);
    if (present.length > 0 && !present.some((label) => kinds[label])) return false;
    if (traceQuery.trim() && !trace.trace_id.toLowerCase().includes(traceQuery.trim().toLowerCase())) return false;
    if (sessionQuery.trim() && !trace.session_id.toLowerCase().includes(sessionQuery.trim().toLowerCase())) return false;
    if (q) {
      const hit =
        trace.trace_id.toLowerCase().includes(q) ||
        trace.session_id.toLowerCase().includes(q) ||
        trace.input_preview.toLowerCase().includes(q) ||
        (trace.output_preview ?? "").toLowerCase().includes(q) ||
        (trace.model ?? "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (!matchRange(trace.duration_ms, durationRange)) return false;
    if (!matchRange(trace.input_tokens ?? 0, inputTokenRange)) return false;
    if (!matchRange(trace.output_tokens ?? 0, outputTokenRange)) return false;
    if (!matchRange(trace.total_tokens, totalTokenRange)) return false;
    if (!matchRange(trace.cost_usd ?? 0, costRange)) return false;
    return true;
  });
  const filteredObservations = observations.filter((row) => {
    if (!withinRange(row.started_at, range, now)) return false;
    if (row.status === "ok" && !showOk) return false;
    if (row.status !== "ok" && !showError) return false;
    if (row.error_kind && !kinds[row.error_kind]) return false;
    if (traceQuery.trim() && !row.trace_id.toLowerCase().includes(traceQuery.trim().toLowerCase())) return false;
    if (sessionQuery.trim() && !row.session_id.toLowerCase().includes(sessionQuery.trim().toLowerCase())) return false;
    if (q) {
      const hit =
        row.trace_id.toLowerCase().includes(q) ||
        row.session_id.toLowerCase().includes(q) ||
        row.operation.toLowerCase().includes(q) ||
        row.input_preview.toLowerCase().includes(q) ||
        row.output_preview.toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (!matchRange(row.duration_ms, durationRange)) return false;
    if (!matchRange(row.input_tokens ?? 0, inputTokenRange)) return false;
    if (!matchRange(row.output_tokens ?? 0, outputTokenRange)) return false;
    if (!matchRange(row.total_tokens, totalTokenRange)) return false;
    if (!matchRange(row.cost_usd, costRange)) return false;
    return true;
  });
  const rows = mode === "traces" ? filteredTraces : filteredObservations;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-foreground">{t("ledger.filters")}</span>
          {sessionFilter ? (
            <button type="button" onClick={onClearSession} className="text-xs text-primary hover:underline">
              {t("filter.clearSession")}
            </button>
          ) : null}
        </div>

        <div className="divide-y divide-border text-sm">
          <div className="space-y-2 p-3.5">
            <div className="text-xs font-medium text-muted-foreground">{t("ledger.range")}</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5">
              {(["1d", "7d", "all"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={[
                    "h-7 rounded-md px-1.5 text-xs transition-colors",
                    range === item ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  onClick={() => { setRange(item); setPage(0); }}
                >
                  {item === "1d" ? t("ledger.dayShort") : item === "7d" ? t("ledger.weekShort") : t("ledger.allShort")}
                </button>
              ))}
            </div>
          </div>

          <FilterGroup title={t("columns.status")} defaultOpen>
            <CheckRow
              label={<StatusPill status="ok" />}
              count={inWindow.filter((trace) => trace.status === "ok").length}
              checked={showOk}
              onChange={setShowOk}
            />
            <CheckRow
              label={<StatusPill status="error" />}
              count={inWindow.filter((trace) => trace.status !== "ok").length}
              checked={showError}
              onChange={setShowError}
            />
          </FilterGroup>

          <FilterGroup title={t("columns.errorType")} defaultOpen>
            <CheckRow
              label={<span className="text-xs">{t("errors.tool")}</span>}
              count={kindCount("tool")}
              checked={kinds.tool}
              onChange={(checked) => setKinds((current) => ({ ...current, tool: checked }))}
            />
            <CheckRow
              label={<span className="text-xs">{t("errors.model")}</span>}
              count={kindCount("model")}
              checked={kinds.model}
              onChange={(checked) => setKinds((current) => ({ ...current, model: checked }))}
            />
            <CheckRow
              label={<span className="text-xs">{t("errors.subagent")}</span>}
              count={kindCount("subagent")}
              checked={kinds.subagent}
              onChange={(checked) => setKinds((current) => ({ ...current, subagent: checked }))}
            />
            <CheckRow
              label={<span className="text-xs">{t("errors.run")}</span>}
              count={kindCount("run")}
              checked={kinds.run}
              onChange={(checked) => setKinds((current) => ({ ...current, run: checked }))}
            />
          </FilterGroup>

          <FilterGroup title={t("traceId")} defaultOpen>
            <Input
              value={traceQuery}
              onChange={(event) => { setTraceQuery(event.target.value); setPage(0); }}
              placeholder="near:..."
              className="h-8 text-xs"
            />
          </FilterGroup>

          <FilterGroup title={t("columns.session")} defaultOpen>
            <Input
              value={sessionQuery}
              onChange={(event) => { setSessionQuery(event.target.value); setPage(0); }}
              placeholder="session id..."
              className="h-8 text-xs"
            />
          </FilterGroup>

          <RangeFilterGroup title={t("ledger.maxDuration")} value={durationRange} onChange={(next) => { setDurationRange(next); setPage(0); }} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.inputTokens")} value={inputTokenRange} onChange={(next) => { setInputTokenRange(next); setPage(0); }} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.outputTokens")} value={outputTokenRange} onChange={(next) => { setOutputTokenRange(next); setPage(0); }} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.maxTokens")} value={totalTokenRange} onChange={(next) => { setTotalTokenRange(next); setPage(0); }} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.maxCost")} value={costRange} onChange={(next) => { setCostRange(next); setPage(0); }} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
        </div>
      </aside>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5">
              <button
                type="button"
                onClick={() => { setMode("traces"); setPage(0); }}
                className={[
                  "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                  mode === "traces" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {t("ledger.traces")}
              </button>
              <button
                type="button"
                onClick={() => { setMode("observations"); setPage(0); }}
                className={[
                  "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                  mode === "observations" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {t("ledger.observations")}
              </button>
            </div>
            <div className="relative w-64 sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => { setKeyword(event.target.value); setPage(0); }}
                placeholder={t("filter.search")}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{t("ledger.count", { count: rows.length })}</span>
        </div>

        {visible.length === 0 ? (
          <EmptyState title={t("empty")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.status")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.errorType")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.time")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("traceId")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.operation")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.model")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.input")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.output")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("columns.duration")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("columns.tokens")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("costUsd")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mode === "traces"
                    ? (visible as TraceSummary[]).map((row) => {
                        const labels = labelsOf(row);
                        const active = selectedTraceId === row.trace_id;
                        return (
                          <tr
                            key={row.trace_id}
                            className={[
                              "cursor-pointer transition-colors hover:bg-muted/60",
                              row.status === "ok" ? "" : "bg-danger-soft/20",
                              active ? "bg-primary-soft/40" : "",
                            ].join(" ")}
                            onClick={() => onOpen(row.trace_id)}
                          >
                            <td className="whitespace-nowrap px-3.5 py-2.5">
                              <StatusPill status={row.status} />
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5">
                              <ErrorTypeBadges labels={labels} translate={t} />
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                              {formatWhen(row.started_at)}
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-foreground" title={row.trace_id}>
                              {shortId(row.trace_id)}
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-medium">{row.operation}</td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                              {row.model ?? "—"}
                            </td>
                            <td className="max-w-[200px] truncate px-3.5 py-2.5 text-xs" title={row.input_preview}>
                              {row.input_preview || "—"}
                            </td>
                            <td className="max-w-[220px] truncate px-3.5 py-2.5 text-xs text-muted-foreground" title={row.output_preview}>
                              {row.output_preview || "—"}
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                              {formatDuration(row.duration_ms)}
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs">
                              {row.total_tokens.toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                              ${(row.cost_usd ?? 0).toFixed(4)}
                            </td>
                          </tr>
                        );
                      })
                    : (visible as SpanObservation[]).map((row) => (
                        <tr
                          key={row.id}
                          className={[
                            "cursor-pointer transition-colors hover:bg-muted/60",
                            row.status === "ok" ? "" : "bg-danger-soft/20",
                          ].join(" ")}
                          onClick={() => onOpen(row.trace_id)}
                        >
                          <td className="whitespace-nowrap px-3.5 py-2.5">
                            <StatusPill status={row.status} />
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5">
                            <ErrorTypeBadges labels={row.error_kind ? [row.error_kind] : []} translate={t} />
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                            {formatWhen(row.started_at)}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-foreground" title={row.trace_id}>
                            {shortId(row.trace_id)}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-xs font-medium">{row.operation}</td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                            {row.model ?? "—"}
                          </td>
                          <td className="max-w-[200px] truncate px-3.5 py-2.5 text-xs" title={row.input_preview}>
                            {row.input_preview || "—"}
                          </td>
                          <td className="max-w-[220px] truncate px-3.5 py-2.5 text-xs text-muted-foreground" title={row.output_preview}>
                            {row.output_preview || "—"}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                            {formatDuration(row.duration_ms)}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs">
                            {row.total_tokens.toLocaleString()}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                            ${row.cost_usd.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground">
              <span>{t("ledger.count", { count: rows.length })}</span>
              <div className="flex items-center gap-2">
                <Button type="button" size="xs" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  {t("ledger.prev")}
                </Button>
                <span className="font-mono">{safePage + 1} / {pageCount}</span>
                <Button type="button" size="xs" variant="outline" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>
                  {t("ledger.next")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="p-3.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between text-xs font-medium text-foreground"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open ? <div className="mt-2.5 space-y-2">{children}</div> : null}
    </div>
  );
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: ReactNode;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={(state) => onChange(Boolean(state))} />
        {label}
      </span>
      <span className="font-mono text-xs text-muted-foreground">{count}</span>
    </label>
  );
}

function RangeFilterGroup({
  title,
  value,
  onChange,
  minLabel,
  maxLabel,
}: {
  title: string;
  value: RangeValue;
  onChange: (next: RangeValue) => void;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <FilterGroup title={title}>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          value={value.min}
          onChange={(event) => onChange({ ...value, min: event.target.value })}
          placeholder={minLabel}
          className="h-8 text-xs"
        />
        <Input
          value={value.max}
          onChange={(event) => onChange({ ...value, max: event.target.value })}
          placeholder={maxLabel}
          className="h-8 text-xs"
        />
      </div>
    </FilterGroup>
  );
}

function SessionLedger({
  sessions,
  selectedSessionId,
  onOpen,
}: {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onOpen: (sessionId: string) => void;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const [range, setRange] = useState<LedgerRange>("all");
  const [sessionQuery, setSessionQuery] = useState("");
  const [durationRange, setDurationRange] = useState<RangeValue>(EMPTY_RANGE);
  const [tracesRange, setTracesRange] = useState<RangeValue>(EMPTY_RANGE);
  const [inputTokenRange, setInputTokenRange] = useState<RangeValue>(EMPTY_RANGE);
  const [outputTokenRange, setOutputTokenRange] = useState<RangeValue>(EMPTY_RANGE);
  const [totalTokenRange, setTotalTokenRange] = useState<RangeValue>(EMPTY_RANGE);
  const [costRange, setCostRange] = useState<RangeValue>(EMPTY_RANGE);

  const now = Date.now();
  const filtered = sessions.filter((session) => {
    if (!withinRange(session.started_at, range, now)) return false;
    if (sessionQuery.trim() && !session.session_id.toLowerCase().includes(sessionQuery.trim().toLowerCase())) return false;
    if (!matchRange(session.duration_ms, durationRange)) return false;
    if (!matchRange(session.trace_count, tracesRange)) return false;
    if (!matchRange(session.input_tokens ?? 0, inputTokenRange)) return false;
    if (!matchRange(session.output_tokens ?? 0, outputTokenRange)) return false;
    if (!matchRange(session.total_tokens, totalTokenRange)) return false;
    if (!matchRange(session.cost_usd ?? 0, costRange)) return false;
    return true;
  });

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-3.5 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-foreground">{t("ledger.filters")}</span>
        </div>
        <div className="divide-y divide-border text-sm">
          <div className="space-y-2 p-3.5">
            <div className="text-xs font-medium text-muted-foreground">{t("ledger.range")}</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5">
              {(["1d", "7d", "all"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={[
                    "h-7 rounded-md px-1.5 text-xs transition-colors",
                    range === item ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  onClick={() => setRange(item)}
                >
                  {item === "1d" ? t("ledger.dayShort") : item === "7d" ? t("ledger.weekShort") : t("ledger.allShort")}
                </button>
              ))}
            </div>
          </div>

          <FilterGroup title={t("columns.session")} defaultOpen>
            <Input
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder="session id..."
              className="h-8 text-xs"
            />
          </FilterGroup>

          <RangeFilterGroup title={t("ledger.sessionDuration")} value={durationRange} onChange={setDurationRange} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.tracesCount")} value={tracesRange} onChange={setTracesRange} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.inputTokens")} value={inputTokenRange} onChange={setInputTokenRange} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.outputTokens")} value={outputTokenRange} onChange={setOutputTokenRange} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.maxTokens")} value={totalTokenRange} onChange={setTotalTokenRange} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
          <RangeFilterGroup title={t("ledger.maxCost")} value={costRange} onChange={setCostRange} minLabel={t("ledger.min")} maxLabel={t("ledger.max")} />
        </div>
      </aside>

      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between">
          <div className="relative w-64 sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder={t("filter.search")}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground">{t("ledger.count", { count: filtered.length })}</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={t("empty")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.session")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.createdAt")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("columns.duration")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.model")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("columns.traces")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.input")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("columns.tokens")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium">{t("costUsd")}</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 font-medium">{t("columns.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((session) => {
                    const active = selectedSessionId === session.session_id;
                    const modelLabel = session.models && session.models.length > 0 ? session.models.join(", ") : "—";
                    return (
                      <tr
                        key={session.session_id}
                        className={[
                          "cursor-pointer transition-colors hover:bg-muted/60",
                          active ? "bg-primary-soft/40" : "",
                        ].join(" ")}
                        onClick={() => onOpen(session.session_id)}
                      >
                        <td className="max-w-[200px] truncate px-3.5 py-2.5 font-mono text-xs text-foreground" title={session.session_id}>
                          {shortTraceId(session.session_id)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatWhen(session.started_at)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                          {formatDuration(session.duration_ms)}
                        </td>
                        <td className="max-w-[180px] truncate px-3.5 py-2.5 font-mono text-xs text-muted-foreground" title={modelLabel}>
                          {modelLabel}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs">
                          {session.trace_count}
                        </td>
                        <td className="max-w-[240px] truncate px-3.5 py-2.5 text-xs" title={session.input_preview}>
                          {session.input_preview || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs">
                          {`${(session.input_tokens ?? 0).toLocaleString()} → ${(session.output_tokens ?? 0).toLocaleString()} (Σ ${session.total_tokens.toLocaleString()})`}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                          ${(session.cost_usd ?? 0).toFixed(4)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <StatusPill status={session.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function spanTitle(span: TraceSpan, kindLabel: (kind: string) => string): string {
  return metaText(span, "tool_name") || metaText(span, "subagent_name") || span.model || kindLabel(span.step_kind);
}

function spanIo(span: TraceSpan, spans: TraceSpan[]): { input: string; output: string } {
  if (span.step_kind === "run") {
    const reply = spans.map((item) => metaText(item, "reply")).find((text) => text.length > 0) ?? "";
    return { input: metaText(span, "user_text"), output: reply };
  }
  if (span.step_kind === "thought") {
    return { input: "", output: metaText(span, "thought") };
  }
  if (span.step_kind === "model") {
    const run = spans.find((item) => item.step_kind === "run");
    return { input: metaText(run ?? span, "user_text"), output: metaText(span, "reply") };
  }
  if (span.step_kind === "tool") {
    return { input: metaText(span, "tool_name"), output: span.status };
  }
  if (span.step_kind === "subagent") {
    return { input: metaText(span, "subagent_name"), output: span.status };
  }
  return { input: "", output: span.error_message ?? "" };
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "run") return <Bot className="h-3.5 w-3.5 text-primary" />;
  if (kind === "model") return <Sparkles className="h-3.5 w-3.5 text-chart-3" />;
  if (kind === "tool") return <Wrench className="h-3.5 w-3.5 text-warning" />;
  if (kind === "thought") return <Brain className="h-3.5 w-3.5 text-info" />;
  return <Cpu className="h-3.5 w-3.5 text-muted-foreground" />;
}

function TraceExplorer({
  detail,
  summary,
}: {
  detail: TraceDetail;
  summary: TraceSummary | null;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const { trace_id: traceId, status, spans, total_usage: totalUsage } = detail;
  const fullTree = useMemo(() => buildTraceTree(spans), [spans]);
  const [treeSearch, setTreeSearch] = useState("");
  const tree = useMemo(() => filterTreeNodes(fullTree, treeSearch), [fullTree, treeSearch]);
  const parts = traceParts(traceId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"formatted" | "json">("formatted");

  const fallback = fullTree.find((node) => node.span.step_kind === "run") ?? fullTree[0] ?? null;
  const selected = findNode(fullTree, selectedKey) ?? fallback;

  const kindLabel = (kind: string) => {
    if (kind === "model" || kind === "tool" || kind === "subagent" || kind === "run" || kind === "thought") {
      return t(`kindLabel.${kind}`);
    }
    return kind;
  };

  const io = selected ? spanIo(selected.span, spans) : { input: "", output: "" };
  const runSpan = spans.find((span) => span.step_kind === "run");
  const totalDuration = summary?.duration_ms ?? runSpan?.duration_ms ?? Math.max(0, ...spans.map((span) => span.duration_ms));
  const startedAt = summary?.started_at ?? spans[0]?.created_at ?? "";

  const tags = useMemo(() => {
    const list: string[] = [];
    list.push(traceId.startsWith("near:") ? "desktop" : "web");
    if (spans.some((span) => span.step_kind === "tool")) list.push("has-tools");
    if (spans.some((span) => span.step_kind === "subagent")) list.push("has-subagent");
    if (spans.some((span) => Boolean(metaText(span, "thought")))) list.push("has-reasoning");
    if (parts.session) list.push("with-session");
    return list;
  }, [parts.session, spans, traceId]);

  const errorSpans = useMemo(() => spans.filter((span) => span.status !== "ok"), [spans]);

  const copyTraceId = () => {
    void navigator.clipboard?.writeText(traceId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 抽屉顶部信息栏（对标图 2 头部） */}
      <div className="border-b border-border bg-card px-5 py-3.5 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Trace ID:</span>
          <code className="max-w-[52ch] truncate font-mono text-sm font-semibold text-foreground" title={traceId}>
            {traceId}
          </code>
          <button
            type="button"
            onClick={copyTraceId}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="复制 Trace ID"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <StatusPill status={status} />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
          {startedAt ? <MetaBadge icon={<Clock className="h-3 w-3" />} text={formatWhen(startedAt)} /> : null}
          <MetaBadge icon={<Clock className="h-3 w-3" />} text={formatDuration(totalDuration)} />
          <MetaBadge icon={<Layers className="h-3 w-3" />} text={`${countNodes(fullTree)} Steps`} />
          <MetaBadge
            icon={<Coins className="h-3 w-3" />}
            text={`${totalUsage.input_tokens.toLocaleString()} → ${totalUsage.output_tokens.toLocaleString()} (Σ ${totalUsage.total_tokens.toLocaleString()} tokens)`}
          />
          <MetaBadge text={`$${totalUsage.cost_usd.toFixed(4)}`} />
          {parts.session ? <MetaBadge text={`Session: ${shortTraceId(parts.session)}`} title={parts.session} /> : null}
        </div>
      </div>

      {/* 左右分栏：左侧调用树，右侧详情面板 */}
      <div className="grid min-h-0 flex-1 divide-y divide-border lg:grid-cols-[310px_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="flex min-h-0 flex-col bg-muted/15">
          <div className="border-b border-border p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={treeSearch}
                onChange={(event) => setTreeSearch(event.target.value)}
                placeholder={t("filter.search")}
                className="h-8 bg-background pl-8 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            {tree.map((node) => (
              <TraceTreeRow
                key={node.key}
                node={node}
                depth={0}
                selectedKey={selected?.key ?? null}
                onSelect={setSelectedKey}
                kindLabel={kindLabel}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <p className="text-sm text-muted-foreground">{t("selectNode")}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KindIcon kind={selected.span.step_kind} />
                  <span className="text-base font-semibold text-foreground">{spanTitle(selected.span, kindLabel)}</span>
                </div>
                {selected.span.model ? (
                  <Badge variant="soft" className="font-mono text-xs">
                    {selected.span.model}
                  </Badge>
                ) : null}
              </div>

              {status !== "ok" && errorSpans.length > 0 ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-danger/35 bg-danger-soft/40 p-3 text-xs text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-semibold">{t("ledger.errorSource")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {errorSpans.map((errSpan) => (
                        <button
                          key={errSpan.step_no}
                          type="button"
                          onClick={() => setSelectedKey(`step-${errSpan.step_no}`)}
                          className="inline-flex items-center gap-1 rounded border border-danger/40 bg-background/70 px-2 py-0.5 font-mono text-[11px] hover:bg-background"
                        >
                          <span>#{errSpan.step_no}</span>
                          <span>{spanTitle(errSpan, kindLabel)}</span>
                        </button>
                      ))}
                    </div>
                    {selected.span.error_message ? (
                      <div className="whitespace-pre-wrap break-words font-mono text-[11px] opacity-90">
                        {selected.span.error_message}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("kind")}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                    <KindIcon kind={selected.span.step_kind} />
                    <span>{kindLabel(selected.span.step_kind)}</span>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("duration")}</div>
                  <div className="mt-1 font-mono text-sm font-semibold">
                    {selected.span.step_kind === "thought" ? "—" : formatDuration(selected.span.duration_ms)}
                  </div>
                </div>
                <div
                  className={[
                    "rounded-lg border p-3",
                    selected.span.status === "ok"
                      ? "border-border bg-muted/20"
                      : "border-danger/40 bg-danger-soft/30",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("status")}</div>
                  <div className="mt-1">
                    <StatusPill status={selected.span.status} />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("ledger.tags")}:</span>
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode("formatted")}
                    className={[
                      "rounded px-2 py-0.5 text-[11px] font-medium",
                      viewMode === "formatted" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {t("ledger.formatted")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("json")}
                    className={[
                      "rounded px-2 py-0.5 text-[11px] font-medium",
                      viewMode === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {t("ledger.json")}
                  </button>
                </div>
              </div>

              {selected.span.step_kind !== "thought" && selected.span.total_tokens > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                    Input: {selected.span.input_tokens.toLocaleString()}
                  </span>
                  <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                    Output: {selected.span.output_tokens.toLocaleString()}
                  </span>
                  <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                    Σ {selected.span.total_tokens.toLocaleString()} tokens
                  </span>
                </div>
              ) : null}

              {viewMode === "json" ? (
                <pre className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/25 p-3.5 font-mono text-xs leading-5">
                  {JSON.stringify(selected.span, null, 2)}
                </pre>
              ) : (
                <>
                  <IoBlock label={t("input")} text={io.input} />
                  <IoBlock label={t("output")} text={io.output} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ icon, text, title }: { icon?: ReactNode; text: string; title?: string }) {
  return (
    <span
      title={title ?? text}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
    >
      {icon}
      <span className="truncate">{text}</span>
    </span>
  );
}

function TraceTreeRow({
  node,
  depth,
  selectedKey,
  onSelect,
  kindLabel,
}: {
  node: TraceNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  kindLabel: (kind: string) => string;
}) {
  const selected = node.key === selectedKey;
  const span = node.span;
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.key)}
        className={[
          "flex w-full min-w-0 items-start gap-2 border-l-2 py-2 pr-3 text-left transition-colors hover:bg-muted/70",
          selected ? "border-l-primary bg-primary-soft/50" : "border-l-transparent",
        ].join(" ")}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <span className="mt-0.5 shrink-0">
          <KindIcon kind={span.step_kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{spanTitle(span, kindLabel)}</span>
            {span.status !== "ok" ? (
              <span className="rounded bg-danger-soft px-1 py-0.2 font-mono text-[10px] font-semibold text-danger">
                ERROR
              </span>
            ) : null}
          </span>
          {span.step_kind !== "thought" ? (
            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
              {formatDuration(span.duration_ms)}
              {span.total_tokens > 0
                ? ` · ${span.input_tokens.toLocaleString()}→${span.output_tokens.toLocaleString()} (Σ ${span.total_tokens.toLocaleString()})`
                : ""}
            </span>
          ) : null}
        </span>
      </button>
      {node.children.map((child) => (
        <TraceTreeRow
          key={child.key}
          node={child}
          depth={depth + 1}
          selectedKey={selectedKey}
          onSelect={onSelect}
          kindLabel={kindLabel}
        />
      ))}
    </>
  );
}

function asMarkdown(text: string): string {
  if (!text || text.includes("\n")) return text;
  return text.replace(/ \*\*/g, "\n\n**").replace(/ - /g, "\n- ");
}

function IoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span className="h-3 w-0.5 rounded-full bg-primary" />
        <span>{label}</span>
      </div>
      <div className="max-h-[26rem] overflow-auto rounded-lg border border-border bg-muted/25 p-3.5 text-sm">
        <ConversationMarkdown text={asMarkdown(text)} className="text-sm leading-6" />
      </div>
    </div>
  );
}

function SessionExplorer({
  session,
  sessionTraces,
  onFilterInTraces,
}: {
  session: SessionSummary;
  sessionTraces: TraceSummary[];
  onFilterInTraces: (sessionId: string) => void;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(sessionTraces[0]?.trace_id ?? null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const target = selectedTraceId ?? sessionTraces[0]?.trace_id ?? null;
    if (!target) {
      setTraceDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    void adminFetch(`/api/agent-traces?trace_id=${encodeURIComponent(target)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: TraceDetail } | null) => {
        if (!active) return;
        setTraceDetail(json?.data ?? null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTraceId, sessionTraces]);

  const activeTraceSummary = sessionTraces.find((item) => item.trace_id === (selectedTraceId ?? sessionTraces[0]?.trace_id)) ?? null;
  const tree = useMemo(() => (traceDetail ? buildTraceTree(traceDetail.spans) : []), [traceDetail]);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const fallbackNode = tree.find((node) => node.span.step_kind === "run") ?? tree[0] ?? null;
  const selectedNode = findNode(tree, selectedNodeKey) ?? fallbackNode;

  const kindLabel = (kind: string) => {
    if (kind === "model" || kind === "tool" || kind === "subagent" || kind === "run" || kind === "thought") {
      return t(`kindLabel.${kind}`);
    }
    return kind;
  };

  const io = selectedNode && traceDetail ? spanIo(selectedNode.span, traceDetail.spans) : { input: "", output: "" };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-card px-5 py-3.5 pr-12">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Session ID:</span>
            <code className="max-w-[46ch] truncate font-mono text-sm font-semibold text-foreground" title={session.session_id}>
              {session.session_id}
            </code>
            <StatusPill status={session.status} />
          </div>
          <Button type="button" size="xs" variant="outline" onClick={() => onFilterInTraces(session.session_id)}>
            在 Traces 中过滤此会话
          </Button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
          <MetaBadge icon={<Clock className="h-3 w-3" />} text={formatWhen(session.started_at)} />
          <MetaBadge icon={<Clock className="h-3 w-3" />} text={formatDuration(session.duration_ms)} />
          <MetaBadge icon={<Layers className="h-3 w-3" />} text={`${session.trace_count} Traces`} />
          <MetaBadge
            icon={<Coins className="h-3 w-3" />}
            text={`${(session.input_tokens ?? 0).toLocaleString()} → ${(session.output_tokens ?? 0).toLocaleString()} (Σ ${session.total_tokens.toLocaleString()} tokens)`}
          />
          <MetaBadge text={`$${(session.cost_usd ?? 0).toFixed(4)}`} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 divide-y divide-border lg:grid-cols-[320px_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="flex min-h-0 flex-col bg-muted/15">
          <div className="border-b border-border px-3.5 py-2.5 text-xs font-semibold text-foreground">
            会话调用树 ({sessionTraces.length})
          </div>
          <div className="flex-1 divide-y divide-border overflow-y-auto">
            {sessionTraces.map((trace, idx) => {
              const isCurrent = trace.trace_id === (selectedTraceId ?? sessionTraces[0]?.trace_id);
              return (
                <div key={trace.trace_id} className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTraceId(trace.trace_id);
                      setSelectedNodeKey(null);
                    }}
                    className={[
                      "flex w-full items-start justify-between gap-2 px-3.5 py-2 text-left transition-colors hover:bg-muted/60",
                      isCurrent ? "bg-primary-soft/40" : "",
                    ].join(" ")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="soft" className="font-mono text-[10px]">
                          {t("ledger.round", { index: idx + 1 })}
                        </Badge>
                        <span className="truncate font-mono text-xs font-medium">{shortId(trace.trace_id)}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{trace.input_preview || trace.operation}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusPill status={trace.status} />
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">{formatDuration(trace.duration_ms)}</div>
                    </div>
                  </button>
                  {isCurrent && tree.length > 0 ? (
                    <div className="border-t border-border/60 bg-background/50 py-1">
                      {tree.map((node) => (
                        <TraceTreeRow
                          key={node.key}
                          node={node}
                          depth={1}
                          selectedKey={selectedNode?.key ?? null}
                          onSelect={setSelectedNodeKey}
                          kindLabel={kindLabel}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">正在加载会话节点详情…</p>
          ) : !selectedNode ? (
            <p className="text-sm text-muted-foreground">{t("selectNode")}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KindIcon kind={selectedNode.span.step_kind} />
                  <span className="text-base font-semibold text-foreground">{spanTitle(selectedNode.span, kindLabel)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {activeTraceSummary?.model ? (
                    <Badge variant="soft" className="font-mono text-xs">
                      {activeTraceSummary.model}
                    </Badge>
                  ) : null}
                  <StatusPill status={selectedNode.span.status} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                  {formatDuration(selectedNode.span.duration_ms)}
                </span>
                <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                  Input: {selectedNode.span.input_tokens.toLocaleString()}
                </span>
                <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                  Output: {selectedNode.span.output_tokens.toLocaleString()}
                </span>
                <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                  Σ {selectedNode.span.total_tokens.toLocaleString()} tokens
                </span>
                <span className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono">
                  ${Number(selectedNode.span.cost_usd || 0).toFixed(4)}
                </span>
              </div>

              <IoBlock label={t("input")} text={io.input} />
              <IoBlock label={t("output")} text={io.output} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

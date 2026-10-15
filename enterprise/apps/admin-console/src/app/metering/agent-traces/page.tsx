"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useState } from "react";
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
  EmptyState,
  Input,
  PageHeader,
} from "@agenticx/ui";
import { RefreshCcw } from "lucide-react";
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
  return `${(durationMs / 1000).toFixed(1)}s`;
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
  total_tokens: number;
  error_kind: string | null;
};

type SessionSummary = {
  session_id: string;
  source: "desktop" | "web";
  trace_count: number;
  started_at: string;
  duration_ms: number;
  total_tokens: number;
  input_preview: string;
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

export default function AgentTracesPage({
  embedded = false,
  section,
  onSection,
}: {
  embedded?: boolean;
  section?: CenterTab;
  onSection?: (section: CenterTab) => void;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const [internalTab, setInternalTab] = useState<CenterTab>(section ?? "overview");
  const tab = section ?? internalTab;
  const setTab = (next: CenterTab) => {
    setInternalTab(next);
    onSection?.(next);
  };
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [overview, setOverview] = useState<ObservationOverview | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "error">("all");
  const [sessionFilter, setSessionFilter] = useState("");
  const [queryId, setQueryId] = useState("");
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const loadIds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/agent-traces?catalog=1", { cache: "no-store" });
      const json = (await res.json()) as {
        data?: { traces?: TraceSummary[]; sessions?: SessionSummary[]; overview?: ObservationOverview };
      };
      setTraces(json.data?.traces ?? []);
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
      setTab("traces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIds();
    // 支持 /metering/agent-traces?trace_id=xxx 直达（从 metering trace 下钻跳转）
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("trace_id");
      if (param) {
        setQueryId(param);
        void loadDetail(param);
      }
    }
  }, [loadIds, loadDetail]);

  return (
    <div className={embedded ? "flex flex-col gap-6 px-6 pb-6" : "flex flex-col gap-6 p-6"}>
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
              <RefreshCcw className="mr-2 h-4 w-4" />
              {t("refresh")}
            </Button>
          }
        />
      )}

      {embedded ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => void loadIds()} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {t("refresh")}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {(["overview", "traces", "sessions"] as const).map((item) => (
            <Button key={item} type="button" size="sm" variant={tab === item ? "default" : "outline"} onClick={() => { setTab(item); setDetail(null); }}>
              {t(`tabs.${item}`)}
            </Button>
          ))}
        </div>
      )}

      {detail ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{t("traceDetail")}</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => setDetail(null)}>{t("backToList")}</Button>
          </CardHeader>
          <CardContent>
            <TraceExplorer traceId={detail.trace_id} status={detail.status} spans={detail.spans} />
          </CardContent>
        </Card>
      ) : tab === "overview" ? (
        <OverviewPanel overview={overview} />
      ) : tab === "sessions" ? (
        <SessionTable
          sessions={sessions.filter((session) => !queryId.trim() || session.session_id.includes(queryId.trim()))}
          onOpen={(sessionId) => { setSessionFilter(sessionId); setTab("traces"); }}
        />
      ) : (
        <TraceTable
          traces={traces.filter((trace) => {
            if (statusFilter === "error" && trace.status === "ok") return false;
            if (sessionFilter && trace.session_id !== sessionFilter) return false;
            const q = queryId.trim();
            if (!q) return true;
            return trace.trace_id.includes(q) || trace.session_id.includes(q) || trace.input_preview.includes(q);
          })}
          onOpen={(traceId) => void loadDetail(traceId)}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          queryId={queryId}
          onQueryId={setQueryId}
          sessionFilter={sessionFilter}
          onClearSession={() => setSessionFilter("")}
        />
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
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

function TraceTable({
  traces,
  onOpen,
  statusFilter,
  onStatusFilter,
  queryId,
  onQueryId,
  sessionFilter,
  onClearSession,
}: {
  traces: TraceSummary[];
  onOpen: (traceId: string) => void;
  statusFilter: "all" | "error";
  onStatusFilter: (value: "all" | "error") => void;
  queryId: string;
  onQueryId: (value: string) => void;
  sessionFilter: string;
  onClearSession: () => void;
}) {
  const t = useTranslations("pages.ops.agentTraces");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={statusFilter === "all" ? "default" : "outline"} onClick={() => onStatusFilter("all")}>{t("filter.all")}</Button>
        <Button type="button" size="sm" variant={statusFilter === "error" ? "default" : "outline"} onClick={() => onStatusFilter("error")}>{t("filter.errors")}</Button>
        <Input value={queryId} onChange={(event) => onQueryId(event.target.value)} placeholder={t("filter.search")} className="max-w-sm" />
        {sessionFilter ? <Button type="button" size="sm" variant="outline" onClick={onClearSession}>{t("filter.clearSession")}</Button> : null}
      </div>
      {traces.length === 0 ? <EmptyState title={t("empty")} /> : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("columns.status")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.time")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.source")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.operation")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.model")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.input")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.trace_id} className="cursor-pointer border-b last:border-0 hover:bg-muted" onClick={() => onOpen(trace.trace_id)}>
                  <td className="px-3 py-2">{trace.status === "ok" ? "OK" : trace.error_kind ?? trace.status}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatWhen(trace.started_at)}</td>
                  <td className="px-3 py-2">{trace.source === "desktop" ? t("source.desktop") : t("source.web")}</td>
                  <td className="px-3 py-2">{trace.operation}</td>
                  <td className="px-3 py-2">{trace.model ?? "—"}</td>
                  <td className="max-w-[240px] truncate px-3 py-2" title={trace.input_preview}>{trace.input_preview || "—"}</td>
                  <td className="px-3 py-2">{formatDuration(trace.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SessionTable({ sessions, onOpen }: { sessions: SessionSummary[]; onOpen: (sessionId: string) => void }) {
  const t = useTranslations("pages.ops.agentTraces");
  if (sessions.length === 0) return <EmptyState title={t("empty")} />;
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t("columns.session")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.source")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.traces")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.input")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.tokens")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.status")}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.session_id} className="cursor-pointer border-b last:border-0 hover:bg-muted" onClick={() => onOpen(session.session_id)}>
              <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs" title={session.session_id}>{shortTraceId(session.session_id)}</td>
              <td className="px-3 py-2">{session.source === "desktop" ? t("source.desktop") : t("source.web")}</td>
              <td className="px-3 py-2">{session.trace_count}</td>
              <td className="max-w-[240px] truncate px-3 py-2">{session.input_preview || "—"}</td>
              <td className="px-3 py-2">{session.total_tokens}</td>
              <td className="px-3 py-2">{session.status === "ok" ? "OK" : session.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function spanTitle(span: TraceSpan, kindLabel: (kind: string) => string): string {
  return metaText(span, "tool_name") || metaText(span, "subagent_name") || kindLabel(span.step_kind);
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
    return { input: "", output: metaText(span, "reply") };
  }
  if (span.step_kind === "tool") {
    return { input: metaText(span, "tool_name"), output: span.status };
  }
  if (span.step_kind === "subagent") {
    return { input: metaText(span, "subagent_name"), output: span.status };
  }
  return { input: "", output: span.error_message ?? "" };
}

function TraceExplorer({
  traceId,
  status,
  spans,
}: {
  traceId: string;
  status: string;
  spans: TraceSpan[];
}) {
  const t = useTranslations("pages.ops.agentTraces");
  const tree = buildTraceTree(spans);
  const parts = traceParts(traceId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const fallback = tree.find((node) => node.span.step_kind === "run") ?? tree[0] ?? null;
  const selected = findNode(tree, selectedKey) ?? fallback;
  const kindLabel = (kind: string) => {
    if (kind === "model" || kind === "tool" || kind === "subagent" || kind === "run" || kind === "thought") {
      return t(`kindLabel.${kind}`);
    }
    return kind;
  };
  const io = selected ? spanIo(selected.span, spans) : { input: "", output: "" };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <Chip label={t("status")} value={status} />
        <Chip label={t("session")} value={shortTraceId(parts.session)} title={parts.session} />
        {parts.run ? <Chip label={t("runId")} value={shortTraceId(parts.run)} title={parts.run} /> : null}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 text-sm text-muted-foreground">{t("operationCount", { count: countNodes(tree) })}</div>
          <div className="rounded-md border">
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
        <div className="min-w-0 rounded-md border p-3">
          {!selected ? (
            <p className="text-sm text-muted-foreground">{t("selectNode")}</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">{spanTitle(selected.span, kindLabel)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {selected.span.status}
                  {selected.span.step_kind === "thought" ? "" : ` · ${formatDuration(selected.span.duration_ms)}`}
                  {selected.span.step_kind !== "thought" && selected.span.model ? ` · ${selected.span.model}` : ""}
                  {selected.span.step_kind !== "thought" && selected.span.total_tokens > 0
                    ? ` · ${selected.span.total_tokens} tokens`
                    : ""}
                </div>
              </div>
              <IoBlock label={t("input")} text={io.input} />
              <IoBlock label={t("output")} text={io.output} />
              {selected.span.step_kind !== "thought" && selected.span.error_message ? (
                <p className="whitespace-pre-wrap break-words text-sm text-destructive">{selected.span.error_message}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
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
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.key)}
        className={`flex w-full min-w-0 items-center gap-2 border-l py-2 pr-3 text-left text-sm hover:bg-muted ${selected ? "border-l-primary bg-muted" : "border-l-transparent"}`}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        <span className="min-w-0 flex-1 truncate">{spanTitle(node.span, kindLabel)}</span>
        {node.span.step_kind === "thought" ? null : (
          <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(node.span.duration_ms)}</span>
        )}
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

function Chip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span title={title ?? value} className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </span>
  );
}

function asMarkdown(text: string): string {
  if (!text || text.includes("\n")) return text;
  return text.replace(/ \*\*/g, "\n\n**").replace(/ - /g, "\n- ");
}

function IoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-3 text-sm">
        <ConversationMarkdown text={asMarkdown(text)} className="text-sm leading-6" />
      </div>
    </div>
  );
}


"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TraceNode, TraceNodeKind, TraceTimeline } from "@agenticx/core-api";
import { Badge } from "@agenticx/ui";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { adminFetch } from "../lib/admin-client-auth";
import { computeGanttPlacement, computeTraceTimeWindow } from "../lib/trace-timeline";
import { SessionConversationPanel } from "./session-conversation-panel";
import {
  TraceConversationPanel,
  type TraceConversationPanelLabels,
} from "./trace-conversation-panel";

function isFailed(status?: string): boolean {
  return (
    status === "failed" ||
    status === "error" ||
    (typeof status === "string" && status.startsWith("5"))
  );
}

function kindDotClass(kind: TraceNodeKind, status?: string): string {
  if (isFailed(status)) return "bg-destructive";
  switch (kind) {
    case "model_step":
      return "bg-violet-500";
    case "request":
      return "bg-sky-500";
    case "dr_phase":
      return "bg-amber-500";
    case "dr_lane":
      return "bg-teal-500";
    case "dr_event":
      return "bg-emerald-500";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function kindBadgeVariant(
  kind: TraceNodeKind,
  status?: string,
): "destructive" | "secondary" | "outline" {
  if (isFailed(status)) return "destructive";
  if (kind === "model_step" || kind === "dr_lane") return "outline";
  return "secondary";
}

function ganttBarClass(kind: TraceNodeKind, status?: string): string {
  if (isFailed(status)) return "bg-destructive/80";
  switch (kind) {
    case "model_step":
      return "bg-primary/70";
    case "request":
      return "bg-muted-foreground/50";
    case "dr_phase":
    case "dr_lane":
    case "dr_event":
      return "bg-violet-500/70";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function findNodeById(nodes: TraceNode[], id: string): TraceNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children, id);
    if (child) return child;
  }
  return null;
}

function SourceList({ sources }: { sources: Array<{ title?: string; url?: string }> }) {
  if (sources.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs">
      {sources.map((src, idx) => (
        <li key={`${src.url ?? src.title ?? idx}`}>
          {src.url ? (
            <a href={src.url} target="_blank" rel="noreferrer" className="underline">
              {src.title || src.url}
            </a>
          ) : (
            src.title || "—"
          )}
        </li>
      ))}
    </ul>
  );
}

function TraceTreeRow({
  node,
  depth,
  selectedId,
  tMinMs,
  tMaxMs,
  tKind,
  tExpand,
  tCollapse,
  onSelect,
}: {
  node: TraceNode;
  depth: number;
  selectedId: string | null;
  tMinMs: number | null;
  tMaxMs: number | null;
  tKind: (key: TraceNodeKind) => string;
  tExpand: string;
  tCollapse: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const selected = selectedId === node.id;
  const failed = isFailed(node.status);
  const place =
    tMinMs != null && tMaxMs != null ? computeGanttPlacement(node, tMinMs, tMaxMs) : null;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={`flex w-full cursor-pointer items-center gap-1.5 border-b border-border px-2 py-1.5 text-left hover:bg-muted/50 ${
          selected ? "bg-muted" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node.id);
          }
        }}
      >
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground disabled:opacity-30"
          disabled={!hasChildren}
          aria-label={open ? tCollapse : tExpand}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>
        <span
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${kindDotClass(node.kind, node.status)}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Badge
              variant={kindBadgeVariant(node.kind, node.status)}
              className="h-5 shrink-0 px-1.5 text-[10px]"
            >
              {tKind(node.kind)}
            </Badge>
            <span className={`truncate text-xs ${failed ? "text-destructive" : ""}`}>
              {node.label}
            </span>
          </div>
          {place ? (
            <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`absolute top-0 h-full rounded-full ${ganttBarClass(node.kind, node.status)}`}
                style={{ left: `${place.offsetPct}%`, width: `${place.widthPct}%` }}
              />
            </div>
          ) : null}
        </div>
        <div className="w-14 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
          {node.durationMs != null ? `${node.durationMs}ms` : ""}
        </div>
      </div>
      {open && hasChildren
        ? node.children.map((child) => (
            <TraceTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              tMinMs={tMinMs}
              tMaxMs={tMaxMs}
              tKind={tKind}
              tExpand={tExpand}
              tCollapse={tCollapse}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

/** @deprecated Prefer TraceExplorer; kept for any external row usage. */
export function TraceNodeRow({
  node,
  depth,
  tKind,
  tExpand,
  tCollapse,
}: {
  node: TraceNode;
  depth: number;
  tKind: (key: TraceNodeKind) => string;
  tExpand: string;
  tCollapse: string;
}) {
  return (
    <TraceTreeRow
      node={node}
      depth={depth}
      selectedId={null}
      tMinMs={null}
      tMaxMs={null}
      tKind={tKind}
      tExpand={tExpand}
      tCollapse={tCollapse}
      onSelect={() => undefined}
    />
  );
}

export type TraceExplorerLabels = {
  expand: string;
  collapse: string;
  kind: (key: TraceNodeKind) => string;
  detailTitle: string;
  /** Optional mid-pane eyebrow; falls back to conversation.title */
  contentTitle?: string;
  /** Optional right-pane title; falls back to detailTitle */
  metadataTitle?: string;
  selectHint: string;
  close: string;
  status: string;
  duration: string;
  tokens: string;
  cost: string;
  startedAt: string;
  stage: string;
  errorMessage: string;
  ioTitle: string;
  ioPrompt: string;
  ioCompletion: string;
  attributes: string;
  sources: string;
  emptyAttrs: string;
  conversation: TraceConversationPanelLabels;
};

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5 text-xs last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-mono">{value}</dd>
    </div>
  );
}

export function TraceExplorer({
  data,
  labels,
  className,
}: {
  data: TraceTimeline;
  labels: TraceExplorerLabels;
  className?: string;
}) {
  const timeWindow = useMemo(() => computeTraceTimeWindow(data.nodes), [data.nodes]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversationScope, setConversationScope] = useState<"turn" | "session">("turn");
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setConversationScope("turn");
    setSessionId(null);
  }, [data.trace_id, data.nodes]);

  const selected = selectedId ? findNodeById(data.nodes, selectedId) : null;
  const sources =
    selected?.attrs && Array.isArray((selected.attrs as { sources?: unknown }).sources)
      ? ((selected.attrs as { sources: Array<{ title?: string; url?: string }> }).sources ?? [])
      : [];
  const stage =
    selected?.attrs && typeof (selected.attrs as { stage?: unknown }).stage === "string"
      ? String((selected.attrs as { stage: string }).stage)
      : "";
  const errorMessage =
    selected?.attrs && typeof (selected.attrs as { error_message?: unknown }).error_message === "string"
      ? String((selected.attrs as { error_message: string }).error_message)
      : "";
  const io =
    selected?.attrs &&
    typeof (selected.attrs as { io?: unknown }).io === "object" &&
    (selected.attrs as { io?: unknown }).io !== null
      ? ((selected.attrs as {
          io: { prompt_preview?: string; completion_preview?: string; truncated?: boolean };
        }).io ?? null)
      : null;

  const metadataTitle = labels.metadataTitle ?? labels.detailTitle;
  const contentTitle = labels.contentTitle ?? labels.conversation.title;

  return (
    <div
      className={`grid min-h-[320px] overflow-hidden rounded-md border border-border ${
        selected
          ? "md:grid-cols-[minmax(280px,1.2fr)_minmax(0,1.4fr)_minmax(220px,0.9fr)]"
          : "grid-cols-1"
      } ${className ?? ""}`}
    >
      <div
        className={`max-h-[520px] overflow-auto ${
          selected ? "border-b border-border md:border-b-0 md:border-r" : ""
        }`}
      >
        {data.nodes.map((node) => (
          <TraceTreeRow
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            tMinMs={timeWindow.tMinMs}
            tMaxMs={timeWindow.tMaxMs}
            tKind={labels.kind}
            tExpand={labels.expand}
            tCollapse={labels.collapse}
            onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
          />
        ))}
        {!selected ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{labels.selectHint}</p>
        ) : null}
      </div>
      {selected ? (
        <>
          <div className="max-h-[520px] space-y-3 overflow-auto border-b border-border p-3 md:border-b-0 md:border-r">
            <div className="text-xs font-medium text-muted-foreground">{contentTitle}</div>
            {labels.conversation.scopeTurn && labels.conversation.scopeSession ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs ${
                    conversationScope === "turn"
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setConversationScope("turn")}
                >
                  {labels.conversation.scopeTurn}
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs ${
                    conversationScope === "session"
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  } ${!sessionId ? "cursor-not-allowed opacity-50" : ""}`}
                  disabled={!sessionId}
                  title={!sessionId ? labels.conversation.noSession : undefined}
                  onClick={() => {
                    if (sessionId) setConversationScope("session");
                  }}
                >
                  {labels.conversation.scopeSession}
                </button>
              </div>
            ) : null}
            <div className={conversationScope === "turn" ? "block" : "hidden"}>
              <TraceConversationPanel
                traceId={data.trace_id}
                labels={labels.conversation}
                onSessionId={setSessionId}
              />
            </div>
            {conversationScope === "session" && sessionId ? (
              <SessionConversationPanel
                sessionId={sessionId}
                labels={{
                  title: labels.conversation.titleSession ?? labels.conversation.title,
                  loading: labels.conversation.loading,
                  empty: labels.conversation.empty,
                  loadFailed: labels.conversation.loadFailed,
                  expand: labels.conversation.expand,
                  collapse: labels.conversation.collapse,
                  truncatedHint: labels.conversation.truncatedHint,
                  roleUser: labels.conversation.roleUser,
                  roleAssistant: labels.conversation.roleAssistant,
                  roleTool: labels.conversation.roleTool,
                  roleSystem: labels.conversation.roleSystem,
                  reasoning: labels.conversation.reasoning,
                  attachments: labels.conversation.attachments,
                  chars: labels.conversation.chars,
                  loadEarlier: labels.conversation.loadEarlier ?? "Load earlier",
                  reasoningExpand: labels.conversation.reasoningExpand,
                  reasoningCollapse: labels.conversation.reasoningCollapse,
                }}
              />
            ) : null}
            {io ? (
              <div className="space-y-1.5 border-t border-border pt-3">
                <div className="text-xs font-medium text-muted-foreground">{labels.ioTitle}</div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="mb-1 text-[10px] text-muted-foreground">{labels.ioPrompt}</div>
                  <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                    {io.prompt_preview || "—"}
                  </pre>
                  <div className="mb-1 text-[10px] text-muted-foreground">{labels.ioCompletion}</div>
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                    {io.completion_preview || "—"}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
          <div className="max-h-[520px] space-y-3 overflow-auto p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">{metadataTitle}</div>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={labels.close}
                title={labels.close}
                onClick={() => setSelectedId(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${kindDotClass(selected.kind, selected.status)}`}
                />
                <Badge variant={kindBadgeVariant(selected.kind, selected.status)}>
                  {labels.kind(selected.kind)}
                </Badge>
              </div>
              <div
                className={`text-sm font-medium ${isFailed(selected.status) ? "text-destructive" : ""}`}
              >
                {selected.label}
              </div>
            </div>
            <dl>
              <DetailField label={labels.status} value={selected.status ?? "—"} />
              <DetailField label={labels.stage} value={stage || "—"} />
              <DetailField
                label={labels.duration}
                value={selected.durationMs != null ? `${selected.durationMs}ms` : "—"}
              />
              <DetailField
                label={labels.tokens}
                value={
                  selected.tokens
                    ? `in ${selected.tokens.input} / out ${selected.tokens.output} / total ${selected.tokens.total}`
                    : "—"
                }
              />
              <DetailField
                label={labels.cost}
                value={typeof selected.costUsd === "number" ? selected.costUsd.toFixed(6) : "—"}
              />
              <DetailField label={labels.startedAt} value={selected.startedAt ?? "—"} />
              <DetailField label={labels.errorMessage} value={errorMessage || "—"} />
            </dl>
            {sources.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">{labels.sources}</div>
                <SourceList sources={sources} />
              </div>
            ) : null}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{labels.attributes}</div>
              {selected.attrs && Object.keys(selected.attrs).length > 0 ? (
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
                  {JSON.stringify(selected.attrs, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">{labels.emptyAttrs}</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export type TraceTimelineTreeLabels = {
  loading: string;
  empty: string;
  loadFailed: string;
  expand: string;
  collapse: string;
  kind: (key: TraceNodeKind) => string;
  totalsSteps: string;
  totalsTokens: string;
  totalsDuration: string;
  detailTitle: string;
  contentTitle?: string;
  metadataTitle?: string;
  selectHint: string;
  close: string;
  status: string;
  duration: string;
  tokens: string;
  cost: string;
  startedAt: string;
  stage: string;
  errorMessage: string;
  ioTitle: string;
  ioPrompt: string;
  ioCompletion: string;
  attributes: string;
  sources: string;
  emptyAttrs: string;
  conversation: TraceConversationPanelLabels;
};

/**
 * Compact inline explorer for sheets/drawers. Fetches GET /api/traces/:traceId.
 */
export function TraceTimelineInline({
  traceId,
  labels,
}: {
  traceId: string;
  labels: TraceTimelineTreeLabels;
}) {
  const [data, setData] = useState<TraceTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = traceId.trim();
    if (!id) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await adminFetch(`/api/traces/${encodeURIComponent(id)}`);
        const payload = (await response.json()) as {
          code?: string;
          data?: TraceTimeline;
          message?: string;
        };
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          setError(labels.loadFailed);
          setData(null);
          return;
        }
        if (!response.ok) {
          setError(payload.message ?? labels.loadFailed);
          setData(null);
          return;
        }
        setData(payload.data ?? null);
      } catch {
        if (!cancelled) {
          setError(labels.loadFailed);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId, labels.loadFailed]);

  if (loading) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">{labels.loading}</div>;
  }
  if (error) {
    return <div className="px-3 py-4 text-xs text-destructive">{error}</div>;
  }
  if (!data || data.nodes.length === 0) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">{labels.empty}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 px-1 text-xs text-muted-foreground">
        <span>
          {labels.totalsSteps}:{" "}
          <span className="font-mono text-foreground">{data.totals.steps}</span>
        </span>
        <span>
          {labels.totalsTokens}:{" "}
          <span className="font-mono text-foreground">{data.totals.tokens}</span>
        </span>
        <span>
          {labels.totalsDuration}:{" "}
          <span className="font-mono text-foreground">
            {data.totals.duration_ms != null ? `${data.totals.duration_ms}ms` : "—"}
          </span>
        </span>
      </div>
      <TraceExplorer
        data={data}
        labels={{
          expand: labels.expand,
          collapse: labels.collapse,
          kind: labels.kind,
          detailTitle: labels.detailTitle,
          contentTitle: labels.contentTitle,
          metadataTitle: labels.metadataTitle,
          selectHint: labels.selectHint,
          close: labels.close,
          status: labels.status,
          duration: labels.duration,
          tokens: labels.tokens,
          cost: labels.cost,
          startedAt: labels.startedAt,
          stage: labels.stage,
          errorMessage: labels.errorMessage,
          ioTitle: labels.ioTitle,
          ioPrompt: labels.ioPrompt,
          ioCompletion: labels.ioCompletion,
          attributes: labels.attributes,
          sources: labels.sources,
          emptyAttrs: labels.emptyAttrs,
          conversation: labels.conversation,
        }}
      />
    </div>
  );
}

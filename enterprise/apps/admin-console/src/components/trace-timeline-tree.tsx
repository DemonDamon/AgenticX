"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TraceNode, TraceNodeKind, TraceTimeline } from "@agenticx/core-api";
import { Badge } from "@agenticx/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { adminFetch } from "../lib/admin-client-auth";
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

function collectDurations(nodes: TraceNode[], out: number[] = []): number[] {
  for (const node of nodes) {
    if (typeof node.durationMs === "number" && node.durationMs > 0) {
      out.push(node.durationMs);
    }
    if (node.children.length > 0) collectDurations(node.children, out);
  }
  return out;
}

function findNodeById(nodes: TraceNode[], id: string): TraceNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children, id);
    if (child) return child;
  }
  return null;
}

function findDefaultSelectedId(nodes: TraceNode[]): string | null {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) break;
    if (node.kind === "model_step") return node.id;
    stack.push(...node.children);
  }
  return nodes[0]?.id ?? null;
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
  maxDurationMs,
  tKind,
  tExpand,
  tCollapse,
  onSelect,
}: {
  node: TraceNode;
  depth: number;
  selectedId: string | null;
  maxDurationMs: number;
  tKind: (key: TraceNodeKind) => string;
  tExpand: string;
  tCollapse: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const selected = selectedId === node.id;
  const failed = isFailed(node.status);
  const barPct =
    maxDurationMs > 0 && typeof node.durationMs === "number"
      ? Math.max(4, Math.min(100, (node.durationMs / maxDurationMs) * 100))
      : 0;

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
          {barPct > 0 ? (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${failed ? "bg-destructive/80" : "bg-primary/70"}`}
                style={{ width: `${barPct}%` }}
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
              maxDurationMs={maxDurationMs}
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
      maxDurationMs={0}
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
  selectHint: string;
  status: string;
  duration: string;
  tokens: string;
  cost: string;
  startedAt: string;
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
  const maxDurationMs = useMemo(() => {
    const ds = collectDurations(data.nodes);
    return ds.length > 0 ? Math.max(...ds) : 0;
  }, [data.nodes]);

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    findDefaultSelectedId(data.nodes),
  );

  useEffect(() => {
    setSelectedId(findDefaultSelectedId(data.nodes));
  }, [data.trace_id, data.nodes]);

  const selected = selectedId ? findNodeById(data.nodes, selectedId) : null;
  const sources =
    selected?.attrs && Array.isArray((selected.attrs as { sources?: unknown }).sources)
      ? ((selected.attrs as { sources: Array<{ title?: string; url?: string }> }).sources ?? [])
      : [];

  return (
    <div
      className={`grid min-h-[320px] overflow-hidden rounded-md border border-border md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] ${className ?? ""}`}
    >
      <div className="max-h-[520px] overflow-auto border-b border-border md:border-b-0 md:border-r">
        {data.nodes.map((node) => (
          <TraceTreeRow
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            maxDurationMs={maxDurationMs}
            tKind={labels.kind}
            tExpand={labels.expand}
            tCollapse={labels.collapse}
            onSelect={setSelectedId}
          />
        ))}
      </div>
      <div className="max-h-[520px] space-y-4 overflow-auto p-3">
        <TraceConversationPanel traceId={data.trace_id} labels={labels.conversation} />
        <div className="border-t border-border pt-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{labels.detailTitle}</div>
          {!selected ? (
            <p className="text-xs text-muted-foreground">{labels.selectHint}</p>
          ) : (
            <div className="space-y-3">
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
                  value={
                    typeof selected.costUsd === "number" ? selected.costUsd.toFixed(6) : "—"
                  }
                />
                <DetailField label={labels.startedAt} value={selected.startedAt ?? "—"} />
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
          )}
        </div>
      </div>
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
  selectHint: string;
  status: string;
  duration: string;
  tokens: string;
  cost: string;
  startedAt: string;
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
          selectHint: labels.selectHint,
          status: labels.status,
          duration: labels.duration,
          tokens: labels.tokens,
          cost: labels.cost,
          startedAt: labels.startedAt,
          attributes: labels.attributes,
          sources: labels.sources,
          emptyAttrs: labels.emptyAttrs,
          conversation: labels.conversation,
        }}
      />
    </div>
  );
}

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pause, AlertTriangle } from "lucide-react";
import type { GraphNodeSnapshot } from "./graph-types";

export type GraphFlowNodeData = {
  node: GraphNodeSnapshot;
  selected?: boolean;
};

function statusClasses(status: string): string {
  switch (status) {
    case "running":
      return "border-[var(--ui-btn-primary-bg)] bg-surface-card-strong shadow-sm animate-pulse";
    case "ready":
      return "border-border-strong bg-surface-card-strong";
    case "blocked":
      return "border-amber-500/70 bg-surface-card-strong";
    case "paused":
      return "border-border bg-surface-card opacity-90";
    case "done":
      return "border-emerald-500/50 bg-surface-card-strong";
    case "failed":
      return "border-rose-500/70 bg-surface-card-strong";
    case "cancelled":
    case "skipped":
      return "border-border bg-surface-card opacity-80";
    default:
      return "border-border/60 bg-surface-card";
  }
}

export const GraphNodeView = memo(function GraphNodeView({ data, selected }: NodeProps) {
  const payload = data as GraphFlowNodeData;
  const node = payload.node;
  const status = String(node.status || "pending");
  const isAgent = node.view_role === "agent" || String(node.kind) === "agent";
  return (
    <div
      className={`min-w-[140px] max-w-[180px] rounded-md border px-2.5 py-2 text-left text-text-strong shadow-sm transition ${statusClasses(
        status,
      )} ${selected ? "ring-2 ring-[var(--ui-btn-primary-bg)]/50" : ""}`}
      style={{ color: "var(--text-strong)" }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-text-subtle" />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div
            className="truncate text-[12px] font-medium"
            style={{ color: "var(--text-strong)" }}
          >
            {node.label || node.id}
          </div>
          <div
            className="mt-0.5 truncate text-[11px]"
            style={{ color: "var(--text-subtle)" }}
          >
            {isAgent ? "专家" : "任务"} · {status}
          </div>
        </div>
        {status === "paused" ? (
          <Pause className="h-3 w-3 shrink-0" style={{ color: "var(--text-subtle)" }} />
        ) : null}
        {status === "blocked" ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[9px] text-amber-600 [html[data-theme=dark]_&]:text-amber-300 [html[data-theme=dim]_&]:text-amber-300">
            <AlertTriangle className="h-2.5 w-2.5" />
            待你
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-text-subtle" />
    </div>
  );
});

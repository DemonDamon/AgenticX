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
      return "border-[var(--ui-btn-primary-bg)] bg-surface-card shadow-sm animate-pulse";
    case "ready":
      return "border-border-strong bg-surface-card";
    case "blocked":
      return "border-amber-500/70 bg-surface-card";
    case "paused":
      return "border-border bg-surface-card opacity-80";
    case "done":
      return "border-emerald-500/40 bg-surface-card text-text-subtle";
    case "failed":
      return "border-rose-500/70 bg-surface-card";
    case "cancelled":
    case "skipped":
      return "border-border bg-surface-base text-text-faint";
    default:
      return "border-border/60 bg-surface-base text-text-subtle";
  }
}

export const GraphNodeView = memo(function GraphNodeView({ data, selected }: NodeProps) {
  const payload = data as GraphFlowNodeData;
  const node = payload.node;
  const status = String(node.status || "pending");
  const isAgent = node.view_role === "agent" || String(node.kind) === "agent";
  return (
    <div
      className={`min-w-[140px] max-w-[180px] rounded-md border px-2.5 py-2 text-left shadow-sm transition ${statusClasses(
        status,
      )} ${selected ? "ring-2 ring-[var(--ui-btn-primary-bg)]/50" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-text-faint" />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-text-strong">
            {node.label || node.id}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-text-faint">
            {isAgent ? "专家" : "任务"} · {status}
          </div>
        </div>
        {status === "paused" ? <Pause className="h-3 w-3 shrink-0 text-text-faint" /> : null}
        {status === "blocked" ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[9px] text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-2.5 w-2.5" />
            待你
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-text-faint" />
    </div>
  );
});

import { useMemo, useState } from "react";
import type { SubAgent } from "../store";

type Props = {
  subAgent: SubAgent;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onSelect: (agentId: string) => void;
  selected?: boolean;
};

const statusMap: Record<string, { icon: string; label: string; tone: string }> = {
  pending: { icon: "⏳", label: "等待中", tone: "text-amber-300" },
  running: { icon: "🔄", label: "执行中", tone: "text-cyan-300" },
  completed: { icon: "✅", label: "已完成", tone: "text-emerald-300" },
  failed: { icon: "❌", label: "失败", tone: "text-rose-300" },
  cancelled: { icon: "⏹", label: "已中断", tone: "text-slate-300" }
};

export function SubAgentCard({
  subAgent,
  onCancel,
  onRetry,
  onChat,
  onSelect,
  selected = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const status = useMemo(() => statusMap[subAgent.status] ?? statusMap.pending, [subAgent.status]);
  const canCancel = subAgent.status === "running" || subAgent.status === "pending";
  const canRetry = subAgent.status === "failed" || subAgent.status === "completed" || subAgent.status === "cancelled";

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        selected ? "border-cyan-400/50 bg-cyan-500/10" : "border-border/70 bg-slate-800/40"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button className="text-left" onClick={() => onSelect(subAgent.id)}>
          <div className="text-sm font-medium text-slate-200">{subAgent.name}</div>
          <div className="text-xs text-slate-400">{subAgent.role}</div>
          <div className="text-[11px] text-slate-500">ID: {subAgent.id}</div>
        </button>
        <span className={`text-xs ${status.tone}`}>
          {status.icon} {status.label}
        </span>
      </div>

      <div className="mb-2 line-clamp-2 text-xs text-slate-400">{subAgent.task}</div>
      {subAgent.currentAction ? (
        <div className="mb-2 text-xs text-slate-300">{subAgent.currentAction}</div>
      ) : null}
      {subAgent.resultSummary ? (
        <div className="mb-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
          <div className="mb-1 text-[11px] text-emerald-300">最终摘要</div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-slate-200">
            {subAgent.resultSummary}
          </div>
          {subAgent.outputFiles && subAgent.outputFiles.length > 0 ? (
            <div className="mt-2">
              <div className="text-[11px] text-slate-400">产出文件</div>
              <div className="max-h-20 overflow-y-auto text-[11px] text-cyan-200">
                {subAgent.outputFiles.map((path) => (
                  <div key={path} className="truncate">
                    {path}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {typeof subAgent.progress === "number" ? (
        <div className="mb-2">
          <div className="h-1.5 overflow-hidden rounded bg-slate-700">
            <div className="h-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, subAgent.progress))}%` }} />
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          className="rounded-md border border-cyan-500/50 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/10"
          onClick={() => onChat(subAgent.id)}
        >
          对话
        </button>
        <button
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起详情" : "展开详情"}
        </button>
        <button
          className="rounded-md border border-rose-400/50 px-2 py-1 text-xs text-rose-200 disabled:opacity-40"
          onClick={() => onCancel(subAgent.id)}
          disabled={!canCancel}
        >
          中断
        </button>
        <button
          className="rounded-md border border-emerald-400/50 px-2 py-1 text-xs text-emerald-200 disabled:opacity-40"
          onClick={() => onRetry(subAgent.id)}
          disabled={!canRetry}
        >
          重试
        </button>
      </div>

      {expanded ? (
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-slate-900/60 p-2">
          {subAgent.events.length === 0 ? (
            <div className="text-xs text-slate-500">暂无事件</div>
          ) : (
            subAgent.events
              .slice()
              .reverse()
              .map((evt) => (
                <div key={evt.id} className="text-xs text-slate-300">
                  <span className="mr-1 text-slate-500">[{evt.type}]</span>
                  {evt.content}
                </div>
              ))
          )}
        </div>
      ) : null}
    </div>
  );
}

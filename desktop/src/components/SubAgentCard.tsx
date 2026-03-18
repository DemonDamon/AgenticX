import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubAgent } from "../store";

type Props = {
  subAgent: SubAgent;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onSelect: (agentId: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
  selected?: boolean;
};

const statusMap: Record<string, { icon: string; label: string; tone: string }> = {
  pending: { icon: "⏳", label: "等待中", tone: "text-amber-300" },
  awaiting_confirm: { icon: "🛂", label: "待确认", tone: "text-orange-300" },
  running: { icon: "🔄", label: "执行中", tone: "text-cyan-300" },
  completed: { icon: "✅", label: "已完成", tone: "text-emerald-300" },
  failed: { icon: "❌", label: "失败", tone: "text-rose-300" },
  cancelled: { icon: "⏹", label: "已中断", tone: "text-text-muted" }
};

const AUTO_CONFIRM_SECONDS = 8;

function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
}

function ThinkingDots() {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 agx-dot-pulse" />
      <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 agx-dot-pulse" style={{ animationDelay: "0.2s" }} />
      <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 agx-dot-pulse" style={{ animationDelay: "0.4s" }} />
    </div>
  );
}

function ConfirmWithCountdown({
  question,
  agentId,
  onConfirmResolve,
}: {
  question: string;
  agentId: string;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
}) {
  const [remaining, setRemaining] = useState(AUTO_CONFIRM_SECONDS);
  const resolvedRef = useRef(false);

  useEffect(() => {
    resolvedRef.current = false;
    setRemaining(AUTO_CONFIRM_SECONDS);
    const interval = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          if (!resolvedRef.current) {
            resolvedRef.current = true;
            onConfirmResolve?.(agentId, true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
    // Only restart when agentId or question changes (new confirm request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, question]);

  const pct = ((AUTO_CONFIRM_SECONDS - remaining) / AUTO_CONFIRM_SECONDS) * 100;

  const handleApprove = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onConfirmResolve?.(agentId, true);
  };

  const handleDeny = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onConfirmResolve?.(agentId, false);
  };

  return (
    <div className="mb-2 rounded-md border border-orange-400/30 bg-orange-500/10 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-orange-200">需要你的确认</span>
        <span className="text-[10px] text-orange-300/70">
          {remaining}s 后自动通过
        </span>
      </div>
      <div className="mb-2 max-h-20 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary">
        {question}
      </div>
      {/* countdown progress bar */}
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-card">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-emerald-500/80 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-400"
          onClick={handleApprove}
        >
          通过
        </button>
        <button
          className="rounded-md bg-rose-500/70 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-400"
          onClick={handleDeny}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

export function SubAgentCard({
  subAgent,
  onCancel,
  onRetry,
  onChat,
  onSelect,
  onConfirmResolve,
  selected = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const status = useMemo(() => statusMap[subAgent.status] ?? statusMap.pending, [subAgent.status]);
  const handleCopyDetails = useCallback(() => {
    const header = [
      `智能体: ${subAgent.name} (${subAgent.id})`,
      `角色: ${subAgent.role}`,
      `任务: ${subAgent.task}`,
      `状态: ${status.label}`,
      subAgent.resultSummary ? `摘要: ${subAgent.resultSummary}` : "",
    ].filter(Boolean).join("\n");
    const events = subAgent.events
      .slice()
      .reverse()
      .map((evt) => `[${evt.type}]${evt.content}`)
      .join("\n");
    void navigator.clipboard.writeText(`${header}\n\n${events}`).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    });
  }, [subAgent, status.label]);

  const canCancel =
    subAgent.status === "running" || subAgent.status === "pending" || subAgent.status === "awaiting_confirm";
  const canRetry = subAgent.status === "failed" || subAgent.status === "completed" || subAgent.status === "cancelled";
  const modelLabel =
    subAgent.model
      ? (subAgent.provider ? `${subAgent.provider}/${subAgent.model}` : subAgent.model)
      : "";

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        selected ? "border-cyan-400/50 bg-cyan-500/10" : "border-border bg-surface-card"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button className="text-left" onClick={() => onSelect(subAgent.id)}>
          <div className="text-sm font-medium text-text-strong">{subAgent.name}</div>
          <div className="text-xs text-text-subtle">{subAgent.role}</div>
          <div className="text-[11px] text-text-faint">ID: {subAgent.id}</div>
          {modelLabel ? (
            <div className="mt-1 inline-flex max-w-[220px] items-center rounded bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-cyan-200">
              {modelLabel}
            </div>
          ) : null}
        </button>
        <span className={`text-xs ${status.tone}`}>
          {status.icon} {status.label}
        </span>
      </div>

      <div className="mb-2 line-clamp-2 text-xs text-text-subtle">{subAgent.task}</div>
      {subAgent.currentAction ? (
        <div className="mb-2 text-xs text-text-muted">{subAgent.currentAction}</div>
      ) : null}
      {subAgent.status === "awaiting_confirm" && subAgent.pendingConfirm ? (
        <ConfirmWithCountdown
          question={subAgent.pendingConfirm.question}
          agentId={subAgent.id}
          onConfirmResolve={onConfirmResolve}
        />
      ) : subAgent.status === "awaiting_confirm" ? (
        <div className="mb-2 rounded-md border border-orange-400/30 bg-orange-500/10 p-2 text-xs text-orange-200">
          等待确认中… 请查看弹窗或稍候
        </div>
      ) : null}
      {subAgent.resultSummary ? (
        <div className="mb-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
          <div className="mb-1 text-[11px] text-emerald-300">最终摘要</div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary">
            {subAgent.resultSummary}
          </div>
          {subAgent.outputFiles && subAgent.outputFiles.length > 0 ? (
            <div className="mt-2">
              <div className="text-[11px] text-text-subtle">产出文件</div>
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
          <div className="h-1.5 overflow-hidden rounded bg-surface-card">
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
          className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
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
        <div className="relative mt-2 max-h-52 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-card p-2">
          <button
            className="sticky right-0 top-0 z-10 float-right rounded border border-border bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
            title="复制全部详情"
            onClick={handleCopyDetails}
          >
            {copyFeedback ? "已复制 ✓" : "复制"}
          </button>
          {subAgent.events.length === 0 ? (
            <div className="text-xs text-text-faint">暂无事件</div>
          ) : (
            subAgent.events
              .slice()
              .reverse()
              .map((evt) => (
                <div key={evt.id} className="text-xs text-text-muted">
                  <span className="mr-1 text-text-faint">[{evt.type}]</span>
                  {evt.content}
                </div>
              ))
          )}
          {subAgent.liveOutput?.trim() ? (
            <div className="mt-2 rounded border border-cyan-500/20 bg-cyan-500/5 p-2">
              <div className="mb-1 text-[11px] text-cyan-300">实时输出（代码流）</div>
              {isThinkingPlaceholderText(subAgent.liveOutput) ? (
                <ThinkingDots />
              ) : (
                <div className="agx-code-stream max-h-44 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-text-primary">
                  {subAgent.liveOutput}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

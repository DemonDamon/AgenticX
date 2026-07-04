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

const statusMap: Record<string, { icon: string; label: string; toneClass: string }> = {
  pending: { icon: "⏳", label: "等待中", toneClass: "text-[var(--status-warning)]" },
  awaiting_confirm: { icon: "🛂", label: "待确认", toneClass: "text-[var(--status-warning)]" },
  awaiting_input: { icon: "❓", label: "等待输入", toneClass: "text-[var(--kb-citation-fg)]" },
  running: { icon: "🔄", label: "执行中", toneClass: "text-[var(--kb-citation-fg)]" },
  // FR-2: distinct visual for "paused" (rounds saturated). Amber, not red,
  // to communicate "halted but recoverable" rather than "failed".
  paused: { icon: "⏸", label: "已暂停（触顶）", toneClass: "text-[var(--status-warning)]" },
  completed: { icon: "✅", label: "已完成", toneClass: "text-[var(--status-success)]" },
  failed: { icon: "❌", label: "失败", toneClass: "text-[var(--status-error)]" },
  cancelled: { icon: "⏹", label: "已中断", toneClass: "text-text-muted" },
};

const ACTION_BTN_BASE =
  "rounded-md border px-2 py-1 text-xs font-medium transition disabled:opacity-40";
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.08)] text-[var(--kb-citation-fg)] hover:bg-[rgba(var(--theme-color-rgb),0.14)]`;
const ACTION_BTN_NEUTRAL = `${ACTION_BTN_BASE} border-[var(--border-strong)] text-text-primary hover:bg-surface-hover`;
const ACTION_BTN_DANGER = `${ACTION_BTN_BASE} border-[color-mix(in_srgb,var(--status-error)_45%,transparent)] text-[var(--status-error)] hover:bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)]`;
const ACTION_BTN_SUCCESS = `${ACTION_BTN_BASE} border-[color-mix(in_srgb,var(--status-success)_45%,transparent)] text-[var(--status-success)] hover:bg-[color-mix(in_srgb,var(--status-success)_10%,transparent)]`;

const AUTO_CONFIRM_SECONDS = 8;

/** 高品质旋转弧线 —— 主题色渐变弧 + 外层呼吸光晕，纯 SVG 无依赖 */
function ArcSpinner({ size = 15, dur = "0.85s" }: { size?: number; dur?: string }) {
  const r = 5.5;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {/* 呼吸外晕 */}
      <span
        className="absolute inset-[-2px] rounded-full animate-ping"
        style={{ background: "rgba(var(--theme-color-rgb), 0.22)", animationDuration: "1.6s" }}
      />
      {/* 旋转弧线 SVG */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        style={{ animation: `spin ${dur} linear infinite`, width: size, height: size }}
      >
        {/* 轨道底色 */}
        <circle cx={cx} cy={cy} r={r} stroke="rgba(var(--theme-color-rgb), 0.14)" strokeWidth="1.8" />
        {/* 发光弧线：约 270° */}
        <path
          d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          stroke="rgba(var(--theme-color-rgb), 1)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        {/* 尾端渐隐弧 */}
        <path
          d={`M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`}
          stroke="rgba(var(--theme-color-rgb), 0.5)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx - r} ${cy}`}
          stroke="rgba(var(--theme-color-rgb), 0.18)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** 等待中：慢速弧线，透明度更低 */
function PendingArcSpinner({ size = 15 }: { size?: number }) {
  return <ArcSpinner size={size} dur="1.5s" />;
}

function SubAgentStatusBadge({
  agentStatus,
  label,
  toneClass,
  icon,
}: {
  agentStatus: string;
  label: string;
  toneClass: string;
  icon: string;
}) {
  if (agentStatus === "running") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium"
        style={{ color: "rgb(var(--theme-color-rgb))" }}
        aria-live="polite"
      >
        <ArcSpinner />
        {label}
      </span>
    );
  }

  if (agentStatus === "pending") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${toneClass}`}
      >
        <PendingArcSpinner />
        {label}
      </span>
    );
  }

  return (
    <span className={`text-xs font-medium ${toneClass}`}>
      {icon} {label}
    </span>
  );
}

function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
}

function ThinkingDots() {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[var(--ui-btn-primary-bg)] agx-dot-pulse" />
      <span
        className="h-2.5 w-2.5 rounded-full bg-[var(--ui-btn-primary-bg)] agx-dot-pulse"
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className="h-2.5 w-2.5 rounded-full bg-[var(--ui-btn-primary-bg)] agx-dot-pulse"
        style={{ animationDelay: "0.4s" }}
      />
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
    <div className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--status-warning)]">需要你的确认</span>
        <span className="text-[10px] text-text-muted">
          {remaining}s 后自动通过
        </span>
      </div>
      <div className="mb-2 max-h-20 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary">
        {question}
      </div>
      {/* countdown progress bar */}
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-card">
        <div
          className="h-full rounded-full bg-[var(--status-success)] transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-md px-3 py-1 text-xs font-medium transition hover:opacity-90"
          style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
          onClick={handleApprove}
        >
          通过
        </button>
        <button
          className={`${ACTION_BTN_DANGER} px-3 py-1`}
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
    subAgent.status === "running" || subAgent.status === "pending" || subAgent.status === "awaiting_confirm" || subAgent.status === "awaiting_input";
  const canRetry = subAgent.status === "failed" || subAgent.status === "completed" || subAgent.status === "cancelled" || subAgent.status === "paused";
  const modelLabel =
    subAgent.model
      ? (subAgent.provider ? `${subAgent.provider}/${subAgent.model}` : subAgent.model)
      : "";
  const handleOpenOutputFile = useCallback(async (filePath: string) => {
    const open = window.agenticxDesktop?.shellOpenPath;
    if (!open) return;
    const result = await open(filePath);
    if (!result.ok) {
      console.warn("[SubAgentCard] open file failed:", result.error);
    }
  }, []);

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        selected
          ? "border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.08)]"
          : "border-border bg-surface-card"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button className="text-left" onClick={() => onSelect(subAgent.id)}>
          <div className="text-sm font-medium text-text-strong">{subAgent.name}</div>
          <div className="text-xs text-text-subtle">{subAgent.role}</div>
          <div className="text-[11px] text-text-faint">ID: {subAgent.id}</div>
          {modelLabel ? (
            <div className="mt-1 inline-flex max-w-[220px] items-center rounded border border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--kb-citation-fg)]">
              {modelLabel}
            </div>
          ) : null}
        </button>
        <SubAgentStatusBadge
          agentStatus={subAgent.status}
          label={status.label}
          toneClass={status.toneClass}
          icon={status.icon}
        />
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
        <div className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] p-2 text-xs text-[var(--status-warning)]">
          等待确认中… 请查看弹窗或稍候
        </div>
      ) : null}
      {subAgent.status === "awaiting_input" ? (
        <div className="mb-2 rounded-md border border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.08)] p-2 text-xs text-[var(--kb-citation-fg)]">
          {subAgent.pendingClarification?.prompt
            ? `等待你的输入：${subAgent.pendingClarification.prompt}`
            : "等待你的输入… 请查看弹窗"}
        </div>
      ) : null}
      {subAgent.resultSummary ? (
        <div className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--status-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_6%,transparent)] p-2">
          <div className="mb-1 text-[11px] font-medium text-[var(--status-success)]">最终摘要</div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary">
            {subAgent.resultSummary}
          </div>
          {subAgent.outputFiles && subAgent.outputFiles.length > 0 ? (
            <div className="mt-2">
              <div className="text-[11px] font-medium text-text-primary">产出文件</div>
              <div className="max-h-20 space-y-0.5 overflow-y-auto">
                {subAgent.outputFiles.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="block w-full truncate text-left text-[11px] font-medium text-[var(--kb-citation-fg)] underline underline-offset-2 hover:opacity-80"
                    title={`打开：${path}`}
                    onClick={() => void handleOpenOutputFile(path)}
                  >
                    {path}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {typeof subAgent.progress === "number" ? (
        <div className="mb-2">
          <div className="h-1.5 overflow-hidden rounded bg-surface-card">
            <div className="h-full bg-[var(--ui-btn-primary-bg)]" style={{ width: `${Math.max(0, Math.min(100, subAgent.progress))}%` }} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button className={ACTION_BTN_PRIMARY} onClick={() => onChat(subAgent.id)}>
          对话
        </button>
        <button className={ACTION_BTN_NEUTRAL} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起详情" : "展开详情"}
        </button>
        <button className={ACTION_BTN_DANGER} onClick={() => onCancel(subAgent.id)} disabled={!canCancel}>
          中断
        </button>
        <button className={ACTION_BTN_SUCCESS} onClick={() => onRetry(subAgent.id)} disabled={!canRetry}>
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
            <div className="mt-2 rounded border border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.06)] p-2">
              <div className="mb-1 text-[11px] font-medium text-[var(--kb-citation-fg)]">实时输出（代码流）</div>
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SubAgent } from "../store";
import { useAppStore } from "../store";
import { formatModelOptionLabel } from "../utils/model-display";
import { collectSelectableModelOptions, isModelSelectable } from "../utils/model-options";
import { ProviderIcon } from "./ProviderIcon";

type Props = {
  subAgent: SubAgent;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onModelChange?: (agentId: string, provider: string, model: string) => void;
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
const ACTION_BTN_ACTIVE = `${ACTION_BTN_BASE} border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.16)] text-[var(--kb-citation-fg)] ring-1 ring-[color-mix(in_srgb,var(--ui-btn-primary-border)_55%,transparent)]`;
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

function subAgentModelPickerPanelStyle(anchor: DOMRect): CSSProperties {
  const width = Math.min(280, Math.max(220, anchor.width + 40));
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
  const top = anchor.bottom + 6;
  return { position: "fixed", top, left, width, zIndex: 50 };
}

function SubAgentModelPicker({
  provider,
  model,
  onChange,
}: {
  provider?: string;
  model?: string;
  onChange: (provider: string, model: string) => void;
}) {
  const settings = useAppStore((s) => s.settings.providers);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const options = useMemo(() => collectSelectableModelOptions(settings), [settings]);
  const currentProvider = (provider ?? "").trim();
  const currentModel = (model ?? "").trim();
  const label = useMemo(() => {
    if (!currentModel) return "选择模型";
    if (!currentProvider) return currentModel;
    if (!isModelSelectable(currentProvider, currentModel, settings)) return "选择模型";
    return formatModelOptionLabel(currentProvider, currentModel, settings[currentProvider]);
  }, [currentModel, currentProvider, settings]);

  const syncPanelPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPanelStyle(subAgentModelPickerPanelStyle(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncPanelPosition();
    const onReflow = () => syncPanelPosition();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, syncPanelPosition, options.length]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex max-w-[160px] min-w-0 items-center gap-0.5 rounded border border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--kb-citation-fg)] transition hover:bg-[rgba(var(--theme-color-rgb),0.16)]"
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <ProviderIcon provider={currentProvider} className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
              style={panelStyle}
            >
              {options.length === 0 ? (
                <div className="px-3 py-2 text-center text-[11px] text-text-muted">请先在设置中配置模型</div>
              ) : (
                options.map((opt) => {
                  const isActive = opt.provider === currentProvider && opt.model === currentModel;
                  return (
                    <button
                      key={`${opt.provider}:${opt.model}`}
                      type="button"
                      className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-primary transition-colors ${
                        isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                      }`}
                      title={opt.label}
                      onClick={() => {
                        onChange(opt.provider, opt.model);
                        setOpen(false);
                      }}
                    >
                      <ProviderIcon provider={opt.provider} className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {isActive ? <Check className="h-3 w-3 shrink-0" strokeWidth={2} /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

type MetaBlockTone = "theme";

const metaBlockToneStyles: Record<
  MetaBlockTone,
  { shell: string; title: string; headerBorder: string }
> = {
  theme: {
    shell:
      "border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_22%,transparent)] bg-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_6%,transparent)]",
    title: "text-[var(--kb-citation-fg)]",
    headerBorder: "border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_18%,transparent)]",
  },
};

function MetaBlockIconButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        className={`flex h-6 w-6 items-center justify-center rounded transition hover:bg-[color-mix(in_srgb,var(--surface-hover)_80%,transparent)] ${
          active ? "bg-[rgba(var(--theme-color-rgb),0.12)]" : ""
        }`}
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute right-0 top-7 z-50 whitespace-nowrap rounded bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-muted opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="h-3.5 w-3.5 text-[var(--status-success)]"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8l3.5 3.5L13 4.5" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="h-3.5 w-3.5 text-text-muted"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="5" width="8" height="9" rx="1.2" />
      <path d="M11 5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v8a1 1 0 001 1h1" />
    </svg>
  );
}

function CollapseToggleIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180 text-[var(--kb-citation-fg)]" : "text-text-muted"}`}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function MetaBlockCollapseButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <MetaBlockIconButton label={expanded ? "收起" : "展开"} active={expanded} onClick={onToggle}>
      <CollapseToggleIcon expanded={expanded} />
    </MetaBlockIconButton>
  );
}

function SubAgentMetaBlock({
  title,
  tone,
  headerActions,
  scrollable = false,
  children,
}: {
  title: string;
  tone: MetaBlockTone;
  headerActions?: ReactNode;
  scrollable?: boolean;
  children: ReactNode;
}) {
  const styles = metaBlockToneStyles[tone];
  return (
    <div className={`mb-2 overflow-hidden rounded-md border ${styles.shell}`}>
      <div
        className={`flex items-center justify-between border-b px-2.5 py-1.5 ${styles.headerBorder}`}
      >
        <span className={`text-[11px] font-medium ${styles.title}`}>{title}</span>
        {headerActions ? <div className="flex items-center gap-0.5">{headerActions}</div> : null}
      </div>
      <div
        className={`px-2.5 py-2 text-xs leading-relaxed text-text-primary ${
          scrollable ? "max-h-40 overflow-y-auto" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** 任务指令块：与「最终摘要」共用同一套元数据卡片结构 */
function TaskInstructionBlock({ task }: { task: string }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editValue, setEditValue] = useState(task);
  if (!task) return null;

  const displayTask = editing ? editValue : task;

  const handleCopy = () => {
    void navigator.clipboard.writeText(displayTask).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <SubAgentMetaBlock
      title="详细指令"
      tone="theme"
      scrollable={!expanded && !editing}
      headerActions={
        <>
          <MetaBlockIconButton label="复制指令" onClick={handleCopy}>
            <CopyIcon copied={copied} />
          </MetaBlockIconButton>
          <MetaBlockIconButton
            label={editing ? "完成编辑" : "编辑指令"}
            active={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className={`h-3.5 w-3.5 ${editing ? "text-[var(--kb-citation-fg)]" : "text-text-muted"}`}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z" />
            </svg>
          </MetaBlockIconButton>
          <MetaBlockCollapseButton expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </>
      }
    >
      {editing ? (
        <textarea
          className="w-full resize-none rounded border border-[var(--ui-btn-primary-border)] bg-surface-card px-2 py-1.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-[var(--ui-btn-primary-border)]"
          rows={4}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          autoFocus
        />
      ) : (
        <p className="whitespace-pre-wrap">{task}</p>
      )}
    </SubAgentMetaBlock>
  );
}

function ResultSummaryBlock({
  summary,
  outputFiles,
  onOpenFile,
}: {
  summary: string;
  outputFiles?: string[];
  onOpenFile: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <SubAgentMetaBlock
      title="最终摘要"
      tone="theme"
      scrollable={!expanded}
      headerActions={
        <>
          <MetaBlockIconButton label="复制摘要" onClick={handleCopy}>
            <CopyIcon copied={copied} />
          </MetaBlockIconButton>
          <MetaBlockCollapseButton expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </>
      }
    >
      <div className="agx-subagent-summary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
      </div>
      {outputFiles && outputFiles.length > 0 ? (
        <div className="mt-2 border-t border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_15%,transparent)] pt-2">
          <div className="mb-1 text-[11px] font-medium text-text-primary">产出文件</div>
          <div className="max-h-20 space-y-0.5 overflow-y-auto">
            {outputFiles.map((path) => (
              <button
                key={path}
                type="button"
                className="block w-full truncate text-left text-[11px] font-medium text-[var(--kb-citation-fg)] underline underline-offset-2 hover:opacity-80"
                title={`打开：${path}`}
                onClick={() => void onOpenFile(path)}
              >
                {path}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </SubAgentMetaBlock>
  );
}

export function SubAgentCard({
  subAgent,
  onCancel,
  onRetry,
  onChat,
  onModelChange,
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
        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-text-strong">{subAgent.name}</span>
            {onModelChange ? (
              <SubAgentModelPicker
                provider={subAgent.provider}
                model={subAgent.model}
                onChange={(provider, model) => onModelChange(subAgent.id, provider, model)}
              />
            ) : null}
            <span
              className="select-all rounded bg-surface-card-strong px-1 py-0.5 font-mono text-[10px] text-text-muted ring-1 ring-border"
              title={`ID: ${subAgent.id}`}
            >
              {subAgent.id}
            </span>
          </div>
        </div>
        <SubAgentStatusBadge
          agentStatus={subAgent.status}
          label={status.label}
          toneClass={status.toneClass}
          icon={status.icon}
        />
      </div>

      <TaskInstructionBlock task={subAgent.task} />
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
        <ResultSummaryBlock
          summary={subAgent.resultSummary}
          outputFiles={subAgent.outputFiles}
          onOpenFile={handleOpenOutputFile}
        />
      ) : null}
      {typeof subAgent.progress === "number" ? (
        <div className="mb-2">
          <div className="h-1.5 overflow-hidden rounded bg-surface-card">
            <div className="h-full bg-[var(--ui-btn-primary-bg)]" style={{ width: `${Math.max(0, Math.min(100, subAgent.progress))}%` }} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={selected ? ACTION_BTN_ACTIVE : ACTION_BTN_PRIMARY}
          aria-pressed={selected}
          title={selected ? "结束与该子智能体的对话，切回 Meta" : "向该子智能体发送消息"}
          onClick={() => onChat(subAgent.id)}
        >
          {selected ? "关闭对话" : "对话"}
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
          {/* 任务指令完整内容已在卡片顶部常驻展示 */}
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

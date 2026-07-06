import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { SubAgent } from "../store";
import { useAppStore } from "../store";
import { formatModelOptionLabel } from "../utils/model-display";
import { collectSelectableModelOptions, isModelSelectable } from "../utils/model-options";
import { resolveSubAgentOutputPaths } from "../utils/subagent-output-files";
import { fetchArtifactPreview, type ArtifactPreviewResponse } from "./subagent/run-drawer-api";
import { previewBaseName } from "./workspace/workspace-preview-types";
import { isSubAgentLiveStatus } from "../utils/stream-overlay-policy";
import { CitationMarkdownBody } from "./messages/CitationMarkdownBody";
import { ProviderIcon } from "./ProviderIcon";

type Props = {
  subAgent: SubAgent;
  /** Pane/session fallback when subAgent.sessionId is unset (e.g. legacy hydration). */
  parentSessionId?: string;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onModelChange?: (agentId: string, provider: string, model: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
  selected?: boolean;
};

type StatusTone = "success" | "error" | "warning" | "theme" | "muted";

const statusMap: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "等待中", tone: "warning" },
  awaiting_confirm: { label: "待确认", tone: "warning" },
  awaiting_input: { label: "等待输入", tone: "theme" },
  running: { label: "执行中", tone: "theme" },
  paused: { label: "已暂停", tone: "warning" },
  completed: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "error" },
  cancelled: { label: "已中断", tone: "muted" },
};

const STATUS_PILL_CLASS: Record<StatusTone, string> = {
  success:
    "border-border bg-[color-mix(in_srgb,var(--status-success)_4%,transparent)] text-[color-mix(in_srgb,var(--status-success)_78%,var(--text-primary))]",
  error:
    "border-border bg-[color-mix(in_srgb,var(--status-error)_4%,transparent)] text-[color-mix(in_srgb,var(--status-error)_72%,var(--text-primary))]",
  warning:
    "border-border bg-[color-mix(in_srgb,var(--status-warning)_4%,transparent)] text-[color-mix(in_srgb,var(--status-warning)_75%,var(--text-primary))]",
  theme:
    "border-border bg-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_4%,transparent)] text-[var(--kb-citation-fg)]",
  muted: "border-border bg-surface-card-strong text-text-muted",
};

function StatusGlyph({ status }: { status: string }) {
  const cls = "h-[11px] w-[11px] shrink-0";
  switch (status) {
    case "completed":
      return (
        <svg viewBox="0 0 12 12" fill="none" className={cls} aria-hidden>
          <circle cx="6" cy="6" r="4.35" stroke="currentColor" strokeWidth="1.15" opacity="0.82" />
          <path
            d="M4.05 6.1 5.35 7.35 8.05 4.65"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "failed":
      return (
        <svg viewBox="0 0 12 12" fill="none" className={cls} aria-hidden>
          <circle cx="6" cy="6" r="4.75" stroke="currentColor" strokeWidth="1" opacity="0.45" />
          <path d="M4.35 4.35 7.65 7.65M7.65 4.35 4.35 7.65" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      );
    case "cancelled":
      return (
        <svg viewBox="0 0 12 12" fill="none" className={cls} aria-hidden>
          <rect x="3.5" y="3.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      );
    case "paused":
      return (
        <svg viewBox="0 0 12 12" fill="none" className={cls} aria-hidden>
          <path d="M4.5 3.5v5M7.5 3.5v5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case "awaiting_confirm":
      return (
        <svg viewBox="0 0 12 12" fill="none" className={cls} aria-hidden>
          <path
            d="M6 2.5v3.25M6 8.1h.01"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
          <circle cx="6" cy="6" r="4.75" stroke="currentColor" strokeWidth="1" opacity="0.45" />
        </svg>
      );
    case "awaiting_input":
      return (
        <svg viewBox="0 0 12 12" fill="none" className={cls} aria-hidden>
          <path
            d="M2.75 3.5h6.5a1 1 0 0 1 1 1v2.25a1 1 0 0 1-1 1H5.1L3 8.75V6.5a1 1 0 0 1 1-1V3.5z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

// All action buttons share a flat ghost base — no border, consistent height.
const ACTION_BTN_BASE =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-35";
// Primary (对话): filled with a very subtle theme tint
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} bg-[rgba(var(--theme-color-rgb),0.10)] text-[var(--kb-citation-fg)] hover:bg-[rgba(var(--theme-color-rgb),0.18)]`;
// Primary but blocked (执行中，未完成) — visually muted; stays clickable so the
// click still reaches the parent handler and surfaces a reminder toast instead
// of a native `disabled` no-op.
const ACTION_BTN_PRIMARY_BLOCKED = `${ACTION_BTN_BASE} bg-surface-card-strong text-text-faint opacity-60 hover:opacity-80 cursor-not-allowed`;
// Active/selected variant (关闭对话)
const ACTION_BTN_ACTIVE = `${ACTION_BTN_BASE} bg-[rgba(var(--theme-color-rgb),0.20)] text-[var(--kb-citation-fg)] ring-1 ring-[color-mix(in_srgb,var(--ui-btn-primary-border)_60%,transparent)]`;
// Neutral (展开/收起详情): ghost on hover only
const ACTION_BTN_NEUTRAL = `${ACTION_BTN_BASE} text-text-muted hover:bg-surface-hover hover:text-text-primary`;
// Danger (中断): ghost, red text only — no colored border
const ACTION_BTN_DANGER = `${ACTION_BTN_BASE} text-[var(--status-error)] opacity-75 hover:bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] hover:opacity-100`;
// Success (重试): ghost, green text only
const ACTION_BTN_SUCCESS = `${ACTION_BTN_BASE} text-[var(--status-success)] opacity-75 hover:bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] hover:opacity-100`;

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

function SubAgentStatusBadge({ agentStatus, label }: { agentStatus: string; label: string }) {
  const meta = statusMap[agentStatus] ?? statusMap.pending;
  const pillClass = STATUS_PILL_CLASS[meta.tone];

  if (agentStatus === "running") {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none ${pillClass}`}
        aria-live="polite"
      >
        <ArcSpinner size={12} />
        {label}
      </span>
    );
  }

  if (agentStatus === "pending") {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none ${pillClass}`}
      >
        <PendingArcSpinner size={12} />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[11px] font-medium leading-none tracking-[0.01em] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${pillClass}`}
    >
      <StatusGlyph status={agentStatus} />
      {label}
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
          className="inline-flex items-center gap-1 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1 text-[11px] font-medium text-[var(--ui-btn-primary-text)] transition hover:opacity-90"
          onClick={handleApprove}
        >
          通过
        </button>
        <button
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-medium transition text-[var(--status-error)] opacity-75 hover:bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] hover:opacity-100`}
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
function TaskInstructionBlock({ agentId, task }: { agentId: string; task: string }) {
  const updateSubAgent = useAppStore((s) => s.updateSubAgent);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Controlled by the committed value from store so it always reflects saved state.
  const [editValue, setEditValue] = useState(task);
  if (!task) return null;

  const handleCopy = () => {
    void navigator.clipboard.writeText(editing ? editValue : task).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task) {
      updateSubAgent(agentId, { task: trimmed });
    }
    setEditing(false);
  };

  const handleDiscard = () => {
    setEditValue(task);
    setEditing(false);
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
          {editing ? (
            <>
              <MetaBlockIconButton label="保存修改" active onClick={handleSave}>
                <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-[var(--status-success)]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8l3.5 3.5L13 4.5" />
                </svg>
              </MetaBlockIconButton>
              <MetaBlockIconButton label="放弃修改" onClick={handleDiscard}>
                <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-text-muted" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </MetaBlockIconButton>
            </>
          ) : (
            <MetaBlockIconButton
              label="编辑指令"
              active={false}
              onClick={() => { setEditValue(task); setEditing(true); }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                className="h-3.5 w-3.5 text-text-muted"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z" />
              </svg>
            </MetaBlockIconButton>
          )}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); }
            if (e.key === "Escape") { e.preventDefault(); handleDiscard(); }
          }}
          autoFocus
        />
      ) : (
        <p className="whitespace-pre-wrap">{task}</p>
      )}
    </SubAgentMetaBlock>
  );
}

type ArtifactPreviewState =
  | { status: "loading" }
  | { status: "ok"; data: ArtifactPreviewResponse }
  | { status: "error"; error: string };

function splitOutputFilePath(path: string): { dirPath: string; fileName: string } {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return { dirPath: "", fileName: normalized };
  return { dirPath: normalized.slice(0, slash), fileName: normalized.slice(slash + 1) };
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function OutputFilesBlock({
  paths,
  sessionId,
  runId,
}: {
  paths: string[];
  sessionId?: string;
  runId: string;
}) {
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const canPreview = Boolean(sessionId && apiBase && apiToken);
  const [blockExpanded, setBlockExpanded] = useState(true);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, ArtifactPreviewState>>({});

  const openFolder = useCallback(async (dirPath: string) => {
    const open = window.agenticxDesktop?.shellOpenPath;
    if (!open || !dirPath) return;
    const result = await open(dirPath);
    if (!result.ok) {
      console.warn("[SubAgentCard] open folder failed:", result.error);
    }
  }, []);

  const togglePreview = useCallback(
    (path: string) => {
      if (!canPreview || !sessionId) {
        void window.agenticxDesktop?.shellOpenPath?.(path);
        return;
      }
      setExpandedPath((cur) => (cur === path ? null : path));
      if (previews[path]) return;
      setPreviews((prev) => ({ ...prev, [path]: { status: "loading" } }));
      fetchArtifactPreview(apiBase, apiToken, sessionId, runId, path)
        .then((data) => {
          setPreviews((prev) => ({
            ...prev,
            [path]: data.ok ? { status: "ok", data } : { status: "error", error: data.error || "预览失败" },
          }));
        })
        .catch((err) => {
          setPreviews((prev) => ({ ...prev, [path]: { status: "error", error: String(err) } }));
        });
    },
    [apiBase, apiToken, canPreview, sessionId, runId, previews],
  );

  return (
    <SubAgentMetaBlock
      title="产出文件"
      tone="theme"
      scrollable={!blockExpanded}
      headerActions={
        <MetaBlockCollapseButton expanded={blockExpanded} onToggle={() => setBlockExpanded((v) => !v)} />
      }
    >
      <ol className="max-h-48 list-decimal space-y-2 overflow-y-auto pl-4 marker:text-[11px] marker:text-text-muted">
        {paths.map((path) => {
          const { dirPath, fileName } = splitOutputFilePath(path);
          const expanded = expandedPath === path;
          const preview = previews[path];
          return (
            <li key={path} className="text-[11px] leading-snug text-text-primary">
              <div className="break-all font-mono">
                {dirPath ? (
                  <button
                    type="button"
                    className="text-left text-text-muted underline underline-offset-2 hover:text-text-primary"
                    title={`打开文件夹：${dirPath}`}
                    onClick={() => void openFolder(dirPath)}
                  >
                    {dirPath}/
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-left text-[var(--kb-citation-fg)] underline underline-offset-2 hover:opacity-80"
                  title={`预览：${path}`}
                  onClick={() => togglePreview(path)}
                >
                  {fileName || previewBaseName(path)}
                </button>
              </div>
              {expanded ? (
                <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_15%,transparent)] bg-surface-card px-2 py-1.5">
                  {!preview || preview.status === "loading" ? (
                    <div className="text-[11px] text-text-faint">加载中…</div>
                  ) : preview.status === "error" ? (
                    <div className="text-[11px] text-[var(--status-error)]">{preview.error}</div>
                  ) : preview.data.kind === "binary" ? (
                    <div className="text-[11px] text-text-muted">
                      {preview.data.open_hint || "该文件不支持内联预览，请在文件夹中打开"}
                    </div>
                  ) : preview.data.text != null ? (
                    isMarkdownPath(path) ? (
                      <CitationMarkdownBody content={preview.data.text} />
                    ) : (
                      <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-primary">
                        {preview.data.text}
                      </pre>
                    )
                  ) : null}
                  {preview?.status === "ok" && preview.data.kind === "text" && preview.data.truncated ? (
                    <div className="mt-1 text-[10.5px] text-[var(--status-warning)]">
                      {preview.data.open_hint || "文件过大，已截断显示"}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </SubAgentMetaBlock>
  );
}

// ─── Activity Timeline ─────────────────────────────────────────────────────

/** 事件类型 → 图标 + 颜色语义 */
const EVENT_META: Record<
  string,
  { icon: React.ReactNode; dot: string; label: string }
> = {
  tool_call: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 1.5L8 3 9 4l1.5-1.5A2 2 0 117.5 4.5L3.5 8.5A2 2 0 101 10.5L3 9 2 8 .5 9.5A2 2 0 112.5 7.5L6.5 3.5A2 2 0 019.5 1.5z" />
      </svg>
    ),
    dot: "bg-[var(--kb-citation-fg)]",
    label: "工具调用",
  },
  tool_result: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6l3 3 5-5" />
      </svg>
    ),
    dot: "bg-[var(--status-success)]",
    label: "工具结果",
  },
  message: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 8C1.5 8.83 2.17 9.5 3 9.5H8.5l2 2V3C10.5 2.17 9.83 1.5 9 1.5H3C2.17 1.5 1.5 2.17 1.5 3v5z" />
      </svg>
    ),
    dot: "bg-text-muted",
    label: "消息",
  },
  status: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="4" />
        <path d="M6 4v2.5l1.5 1" />
      </svg>
    ),
    dot: "bg-[var(--status-warning)]",
    label: "状态",
  },
  error: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3 text-[var(--status-error)]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="4.5" />
        <path d="M6 4v2.5M6 8.2v.3" />
      </svg>
    ),
    dot: "bg-[var(--status-error)]",
    label: "错误",
  },
  output: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2" width="9" height="8" rx="1.2" />
        <path d="M4 5h4M4 7h2.5" />
      </svg>
    ),
    dot: "bg-text-faint",
    label: "输出",
  },
  reasoning: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 1.5a4.5 4.5 0 010 9" strokeDasharray="2 1.2" />
        <path d="M6 1.5a4.5 4.5 0 000 9" />
        <circle cx="6" cy="6" r="1.2" fill="currentColor" strokeWidth="0" />
      </svg>
    ),
    dot: "bg-violet-400",
    label: "推理",
  },
  final: {
    icon: (
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3 text-[var(--status-success)]" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6.5l2.5 2.5 5.5-5.5" />
      </svg>
    ),
    dot: "bg-[var(--status-success)]",
    label: "完成回复",
  },
};

const DEFAULT_EVENT_META = {
  icon: (
    <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
    </svg>
  ),
  dot: "bg-border",
  label: "事件",
};

function getEventMeta(type: string) {
  const key = type.toLowerCase().replace(/[^a-z_]/g, "");
  return EVENT_META[key] ?? DEFAULT_EVENT_META;
}

/** 把 ms 时间戳格式化为 HH:MM:SS */
function fmtTs(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

type ParsedEventContent = {
  /** 解析出的工具名（若能识别） */
  toolName?: string;
  /** 主体文本（人类可读，已剥离 JSON 包裹） */
  body: string;
  /** 工具调用参数，按 key/value 展示，避免整段 JSON 堆砌 */
  argEntries?: [string, string][];
};

const MAX_ARG_VALUE_LEN = 220;

function stringifyArgValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > MAX_ARG_VALUE_LEN ? `${v.slice(0, MAX_ARG_VALUE_LEN)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > MAX_ARG_VALUE_LEN ? `${s.slice(0, MAX_ARG_VALUE_LEN)}…` : s;
  } catch {
    return String(v);
  }
}

/**
 * 从 bash_exec / shell 类工具结果里提取可读 stdout 内容，剥除 exit_code / stderr 包裹。
 * 形如 "exit_code=0\nstdout:\nXXX\nstderr:\n(empty)" → "XXX"
 */
function extractShellOutput(raw: string): string {
  // 先尝试匹配 "stdout:\nXXX" 到 "stderr:" 或字符串结尾
  const m = raw.match(/stdout:\s*\n([\s\S]*?)(?:\nstderr:|$)/);
  if (m) {
    const out = m[1].trim();
    // 如果 stdout 本身是 (empty) 或空，降级返回原文
    return out && out !== "(empty)" ? out : raw;
  }
  return raw;
}

/**
 * 把原始事件文本（可能是未加工的 JSON 包裹、streaming 预格式化输出）
 * 解析为结构化展示字段，避免在时间线里直接堆原始 JSON。
 * 解析失败时安全退化为纯文本展示，不影响任何未知事件类型。
 */
function parseEventContent(_type: string, rawContent: string): ParsedEventContent {
  const content = rawContent.trim();

  // 情形一：streaming 预格式化工具结果 —— "✅ toolname 结果: ..." / "⚠️ toolname 提示: ..."
  // 这是 formatToolResultMessage 生成的格式，提取工具名和实际输出。
  const preFormattedMatch = content.match(/^[✅⚠️🤝🚀🗂📡]\s*([\w.]+)\s+(?:结果|提示|状态快照):\s*([\s\S]*)$/u);
  if (preFormattedMatch) {
    const toolName = preFormattedMatch[1];
    const body = extractShellOutput(preFormattedMatch[2].trim());
    // 如果是微缩压缩的 [micro-compact ...] 格式，提取实际输出
    const compact = body.replace(/^\[micro-compact[^\]]*\]\s*/i, "");
    return { toolName, body: extractShellOutput(compact) };
  }

  // 情形二：完整原始包裹 —— "tool_call: {...}" / "tool_result: {...}"（轮询路径）
  const wrapMatch = content.match(/^[^\w{]*(tool_call|tool_result)\s*:\s*(\{[\s\S]*\})\s*$/);
  if (wrapMatch) {
    try {
      const obj = JSON.parse(wrapMatch[2]) as Record<string, unknown>;
      if (obj && typeof obj === "object") {
        const toolName = typeof obj.name === "string" ? obj.name : undefined;
        if (wrapMatch[1] === "tool_call") {
          const args = obj.arguments && typeof obj.arguments === "object" ? (obj.arguments as Record<string, unknown>) : {};
          const argEntries = Object.entries(args).map(([k, v]) => [k, stringifyArgValue(v)] as [string, string]);
          return { toolName, body: "", argEntries };
        }
        // tool_result: 提取 result 字段并清洗 shell 输出
        const result = obj.result;
        const raw = typeof result === "string" ? result : stringifyArgValue(result);
        return { toolName, body: extractShellOutput(raw) };
      }
    } catch {
      // JSON 解析失败，落到下面的通用兜底
    }
  }

  // 情形三：简写形式 —— "🔧 name: {...}"（streaming 路径截断 JSON）
  const shorthandMatch = content.match(/^[^\w]*([\w.]+):\s*(\{[\s\S]*)$/);
  if (shorthandMatch) {
    const [, toolName, tail] = shorthandMatch;
    try {
      const obj = JSON.parse(tail) as Record<string, unknown>;
      if (obj && typeof obj === "object") {
        const argEntries = Object.entries(obj).map(([k, v]) => [k, stringifyArgValue(v)] as [string, string]);
        return { toolName, body: "", argEntries };
      }
    } catch {
      // 截断 JSON：只展示工具名 + 短文本，不暴露残缺 JSON
      return { toolName, body: tail.replace(/\{[\s\S]*$/, "").trim() || "…" };
    }
  }

  return { body: content };
}

/** 单条事件行，content 超出 100 字符时折叠 */
function TimelineEvent({ evt }: { evt: { id: string; type: string; content: string; ts: number } }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getEventMeta(evt.type);
  const parsed = useMemo(() => parseEventContent(evt.type, evt.content), [evt.type, evt.content]);
  const LIMIT = evt.type === "reasoning" ? 60 : 100;
  const isLong = parsed.body.length > LIMIT;
  const displayed = !isLong || expanded ? parsed.body : `${parsed.body.slice(0, LIMIT)}…`;

  return (
    <div className="group flex min-w-0 gap-2">
      {/* 左侧竖轨 + 圆点 */}
      <div className="flex flex-col items-center">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot} ring-1 ring-[var(--surface-bg,transparent)] opacity-80`} />
        <span className="mt-0.5 w-px flex-1 bg-border opacity-40" />
      </div>
      {/* 内容区 */}
      <div className="mb-2 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-text-faint opacity-70">{meta.icon}</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{meta.label}</span>
          {parsed.toolName ? (
            <span className="rounded bg-surface-card-strong px-1 py-0.5 font-mono text-[10px] text-[var(--kb-citation-fg)] ring-1 ring-border">
              {parsed.toolName}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-text-faint opacity-60">{fmtTs(evt.ts)}</span>
        </div>

        {/* 工具调用参数：按 key/value 逐行展示，而非原始 JSON */}
        {parsed.argEntries && parsed.argEntries.length > 0 ? (
          <div className="mt-1 space-y-0.5 rounded bg-[color-mix(in_srgb,var(--surface-hover)_60%,transparent)] px-1.5 py-1">
            {parsed.argEntries.map(([k, v]) => (
              <div key={k} className="flex min-w-0 gap-1.5 text-[11px] leading-relaxed">
                <span className="shrink-0 font-mono text-text-faint">{k}</span>
                <span className="min-w-0 flex-1 break-all text-text-primary">{v}</span>
              </div>
            ))}
          </div>
        ) : parsed.body ? (
          <p
            className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-primary"
            style={{ wordBreak: "break-word" }}
          >
            {displayed}
            {isLong ? (
              <button
                type="button"
                className="ml-1 text-[10px] text-[var(--kb-citation-fg)] underline-offset-2 hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "收起" : "展开"}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** 过滤掉冗余的 progress 事件：
 *  - "调用工具 X" / "完成工具 X" 类（tool_call/tool_result 事件已经表达了这层信息）
 *  - 心跳类"执行中（Ns）"（status bar 已有，不必再占时间线）
 *  - 第 1 轮 0s 的轮次播报（等价于"已启动"，毫无新信息量）
 *  - 相邻的重复 progress（同一文本连续出现只保留一条）
 */
const NOISE_PROGRESS_RE = /^(?:调用工具\s|完成工具\s|执行中（\d+s）)/;
const ROUND1_0S_RE = /^第 1\/\d+ 轮分析中（0s）$/;

function denoiseEvents(events: { id: string; type: string; content: string; ts: number }[]) {
  let lastProgressText = "";
  return events.filter((evt) => {
    if (evt.type === "progress") {
      if (NOISE_PROGRESS_RE.test(evt.content)) return false;
      if (ROUND1_0S_RE.test(evt.content.trim())) return false;
      // 相邻重复 progress 去重
      if (evt.content === lastProgressText) return false;
      lastProgressText = evt.content;
      return true;
    }
    if (evt.type === "token") return false;
    return true;
  });
}

function ActivityTimeline({
  events,
  liveOutput,
  agentStatus,
  onCopyDetails,
  copyFeedback,
}: {
  events: { id: string; type: string; content: string; ts: number }[];
  liveOutput?: string;
  agentStatus: string;
  onCopyDetails: () => void;
  copyFeedback: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => denoiseEvents(events), [events]);
  const isLive = isSubAgentLiveStatus(agentStatus);
  // 保持滚动到底部（最新事件可见）
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-card">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-text-muted">
          活动日志
          {visible.length > 0 ? (
            <span className="ml-1.5 font-mono text-[10px] text-text-faint opacity-60">{visible.length} 步</span>
          ) : null}
        </span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
          onClick={onCopyDetails}
        >
          {copyFeedback ? "已复制 ✓" : "复制"}
        </button>
      </div>

      {/* 实时输出：仅执行中展示；完成后 liveOutput 应已清空并落入 reasoning 事件 */}
      {isLive && liveOutput?.trim() ? (
        <div className="border-b border-border px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <ArcSpinner size={10} />
            <span className="text-[10px] font-medium text-[var(--kb-citation-fg)]">实时流</span>
          </div>
          {(() => {
            // Strip <think>/<redacted_thinking> wrappers before display so raw tags never show.
            const clean = liveOutput
              .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "")
              .replace(/<\/?think>/gi, "")
              .trim();
            if (!clean || isThinkingPlaceholderText(clean)) return <ThinkingDots />;
            return (
              <div className="max-h-28 overflow-y-auto rounded bg-[rgba(var(--theme-color-rgb),0.05)] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-text-primary ring-1 ring-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_14%,transparent)]">
                <pre className="whitespace-pre-wrap break-all">{clean}</pre>
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* 事件时间线 */}
      <div
        ref={listRef}
        className="max-h-48 overflow-y-auto px-3 pt-2.5 pb-1"
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
        }}
      >
        {visible.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-text-faint">暂无活动记录</div>
        ) : (
          visible.map((evt) => <TimelineEvent key={evt.id} evt={evt} />)
        )}
      </div>
    </div>
  );
}

export function SubAgentCard({
  subAgent,
  parentSessionId,
  onCancel,
  onRetry,
  onChat,
  onModelChange,
  onConfirmResolve,
  selected = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  // 整卡折叠：把指令/结果/进度/操作按钮等正文整体收起，只留标题一行 —— 已完成的
  // 任务默认收起以减少列表视觉噪音；执行中默认展开，方便随时查看进度与中断。
  const [collapsed, setCollapsed] = useState(subAgent.status === "completed");
  const status = useMemo(() => statusMap[subAgent.status] ?? statusMap.pending, [subAgent.status]);
  const outputPaths = useMemo(
    () =>
      resolveSubAgentOutputPaths(subAgent.resultSummary, {
        resultFile: subAgent.resultFile,
        outputFiles: subAgent.outputFiles,
      }),
    [subAgent.resultSummary, subAgent.resultFile, subAgent.outputFiles],
  );
  const artifactSessionId = subAgent.sessionId || parentSessionId || "";
  const handleCopyDetails = useCallback(() => {
    const header = [
      `智能体: ${subAgent.name} (${subAgent.id})`,
      `角色: ${subAgent.role}`,
      `任务: ${subAgent.task}`,
      `状态: ${status.label}`,
      subAgent.resultSummary ? `产出结果: ${subAgent.resultSummary}` : "",
      subAgent.resultFile ? `落盘路径: ${subAgent.resultFile}` : "",
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
  // 执行中态（含等待确认/等待输入）禁止「对话」— 避免任务未完成时上下文被轻易打断；
  // 关闭一个已开启的对话始终允许（不受此限）。按钮不设 disabled，保留可点击以便
  // 父层拦截点击并弹出提醒 toast，而非静默无响应。
  const chatBlocked = canCancel;

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        selected
          ? "border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.08)]"
          : "border-border bg-surface-card"
      }`}
    >
      <div className={`flex items-start justify-between gap-2 ${collapsed ? "" : "mb-2"}`}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "展开整卡" : "折叠整卡"}
        >
          <svg
            viewBox="0 0 14 14"
            fill="none"
            className={`h-3 w-3 shrink-0 text-text-faint transition-transform ${collapsed ? "-rotate-90" : ""}`}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 5l4 4 4-4" />
          </svg>
          <span className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text-strong">{subAgent.name}</span>
            {!collapsed && onModelChange ? (
              <SubAgentModelPicker
                provider={subAgent.provider}
                model={subAgent.model}
                onChange={(provider, model) => onModelChange(subAgent.id, provider, model)}
              />
            ) : null}
            {!collapsed ? (
              <span
                className="select-all rounded bg-surface-card-strong px-1 py-0.5 font-mono text-[10px] text-text-muted ring-1 ring-border"
                title={`ID: ${subAgent.id}`}
              >
                {subAgent.id}
              </span>
            ) : null}
          </span>
        </button>
        <SubAgentStatusBadge
          agentStatus={subAgent.status}
          label={status.label}
        />
      </div>

      {collapsed ? null : (
        <>
          <TaskInstructionBlock agentId={subAgent.id} task={subAgent.task} />
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
          {outputPaths.length > 0 ? (
            <OutputFilesBlock
              paths={outputPaths}
              sessionId={artifactSessionId || undefined}
              runId={subAgent.id}
            />
          ) : null}
          {typeof subAgent.progress === "number" ? (
            <div className="mb-2">
              <div className="h-1.5 overflow-hidden rounded bg-surface-card">
                <div className="h-full bg-[var(--ui-btn-primary-bg)]" style={{ width: `${Math.max(0, Math.min(100, subAgent.progress))}%` }} />
              </div>
            </div>
          ) : null}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {/* 对话 — primary action */}
            <button
              type="button"
              className={selected ? ACTION_BTN_ACTIVE : chatBlocked ? ACTION_BTN_PRIMARY_BLOCKED : ACTION_BTN_PRIMARY}
              aria-pressed={selected}
              title={
                selected
                  ? "结束与该子智能体的对话，切回 Meta"
                  : chatBlocked
                    ? "任务执行中，完成后才能进入对话"
                    : "向该子智能体发送消息"
              }
              onClick={() => onChat(subAgent.id)}
            >
              <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {selected
                  ? <path d="M2 2l10 10M12 2L2 12" />
                  : <><path d="M2 9.5C2 10.33 2.67 11 3.5 11H10l2 2V4.5C12 3.67 11.33 3 10.5 3h-7C2.67 3 2 3.67 2 4.5v5z" /></>}
              </svg>
              {selected ? "关闭对话" : "对话"}
            </button>

            {/* 展开/收起详情 — neutral */}
            <button
              className={ACTION_BTN_NEUTRAL}
              onClick={() => setExpanded((v) => !v)}
            >
              <svg viewBox="0 0 14 14" fill="none" className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5l4 4 4-4" />
              </svg>
              {expanded ? "收起" : "详情"}
            </button>

            {/* 分隔线 */}
            <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />

            {/* 中断 — danger ghost */}
            <button
              className={ACTION_BTN_DANGER}
              onClick={() => onCancel(subAgent.id)}
              disabled={!canCancel}
            >
              <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="8" height="8" rx="1" />
              </svg>
              中断
            </button>

            {/* 重试 — success ghost */}
            <button
              className={ACTION_BTN_SUCCESS}
              onClick={() => onRetry(subAgent.id)}
              disabled={!canRetry}
            >
              <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 7A4 4 0 013.27 4.27" />
                <path d="M3 2v3h3" />
              </svg>
              重试
            </button>
          </div>

          {expanded ? (
            <ActivityTimeline
              events={subAgent.events}
              liveOutput={subAgent.liveOutput}
              agentStatus={subAgent.status}
              onCopyDetails={handleCopyDetails}
              copyFeedback={copyFeedback}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

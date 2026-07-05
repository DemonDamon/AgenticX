/**
 * Near 极客工牌（Sub-Plan C FR-2）—— compact（集群卡片内一行）与 full（hover / 展开浮层）两态。
 *
 * 视觉走 Near 品牌：极简卡片 + 左侧成员主题色竖条（替代 Kimi 挂绳）、像素首字母块、
 * mono 编号、状态徽章。full 态经 `createPortal` 挂 body，避免被父级 overflow 裁剪。
 */
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { avatarTintBg } from "../../utils/avatar-color";
import { ProviderIcon } from "../ProviderIcon";
import { PixelProgress } from "./PixelProgress";
import {
  BADGE_COMPACT_AVATAR_PX,
  BADGE_FULL_AVATAR_PX,
  BADGE_HOVER_DELAY_MS,
  TONE_COLOR_VAR,
  statusMeta,
} from "./badge-theme";
import type { BadgeVM } from "./badge-vm";

/** 主题色旋转弧（running / pending 用），纯 SVG 无依赖。 */
function BadgeSpinner({ size = 12, dur = "0.85s" }: { size?: number; dur?: string }) {
  const r = size / 2 - 1.4;
  const c = size / 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      style={{ animation: `spin ${dur} linear infinite`, width: size, height: size }}
      aria-hidden
    >
      <circle cx={c} cy={c} r={r} stroke="rgba(var(--theme-color-rgb),0.16)" strokeWidth="1.6" />
      <path
        d={`M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c + r} ${c}`}
        stroke="rgb(var(--theme-color-rgb))"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(status);
  const color = TONE_COLOR_VAR[meta.tone];
  const spinning = status === "running" || status === "pending";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-medium"
      style={{ color }}
      aria-live="polite"
    >
      {spinning ? <BadgeSpinner size={11} dur={status === "pending" ? "1.5s" : "0.85s"} /> : null}
      {meta.label}
    </span>
  );
}

/** 像素首字母块：无头像时的黑白高对比标识，呼应玛奇线稿气质。 */
function InitialTile({ label, size, rounded }: { label: string; size: number; rounded: string }) {
  const char = (label.slice(0, 1) || "?").toUpperCase();
  return (
    <div
      className={`flex shrink-0 items-center justify-center font-mono font-bold ${rounded}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        background: "color-mix(in srgb, var(--text-strong) 88%, transparent)",
        color: "var(--surface-bg, #000)",
      }}
    >
      {char}
    </div>
  );
}

function BadgeAvatar({ vm, size }: { vm: BadgeVM; size: number }) {
  // 集群成员用圆角方形，分身（有 avatarId）用圆形。
  const rounded = vm.avatarId ? "rounded-full" : "rounded-[6px]";
  return <InitialTile label={vm.name} size={size} rounded={rounded} />;
}

function ModelPill({ provider, model }: { provider?: string; model?: string }) {
  if (!model) return null;
  return (
    <span className="inline-flex max-w-[150px] items-center gap-1 rounded border border-border bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-muted">
      {provider ? <ProviderIcon provider={provider} className="h-3 w-3 shrink-0" /> : null}
      <span className="min-w-0 truncate">{model}</span>
    </span>
  );
}

// ── Full 工牌浮层 ──────────────────────────────────────────────────────────

function FullBadgeCard({ vm, anchorRect }: { vm: BadgeVM; anchorRect: DOMRect }) {
  const tint = avatarTintBg(vm.avatarId ?? vm.runId);
  const width = 300;
  const left = Math.min(Math.max(8, anchorRect.left), window.innerWidth - width - 8);
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 220);
  const style: CSSProperties = { position: "fixed", top, left, width, zIndex: 60 };
  return createPortal(
    <div
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-panel p-3 shadow-xl backdrop-blur-xl"
      style={{ ...style, ...(tint ? { backgroundImage: `linear-gradient(${tint}, ${tint})` } : {}) }}
      role="dialog"
      aria-label={`${vm.name} 工牌`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <span
            className="absolute -left-1 top-1 h-[calc(100%-8px)] w-[2px] rounded-full"
            style={{ background: "rgb(var(--theme-color-rgb))" }}
            aria-hidden
          />
          <BadgeAvatar vm={vm} size={BADGE_FULL_AVATAR_PX} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text-strong">{vm.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-text-faint">{vm.badgeSeq}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-text-muted">{vm.role}</div>
          {vm.persona ? (
            <div className="mt-1 truncate text-[11px] italic text-text-faint">「{vm.persona}」</div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusPill status={vm.status} />
        <ModelPill provider={vm.provider} model={vm.model} />
      </div>
      <PixelProgress progress={vm.progress} status={vm.status} />
      {vm.resultSummary ? (
        <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-card px-2 py-1.5 text-[11px] leading-relaxed text-text-primary">
          {vm.resultSummary}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

// ── Compact 工牌（集群卡片内一行）──────────────────────────────────────────

type Props = {
  vm: BadgeVM;
  selected?: boolean;
  onClick?: (runId: string) => void;
};

export function AgentBadge({ vm, selected = false, onClick }: Props) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const tint = avatarTintBg(vm.avatarId ?? vm.runId);

  const openFull = useCallback(() => {
    const el = rowRef.current;
    if (el) setAnchorRect(el.getBoundingClientRect());
    setShowFull(true);
  }, []);

  const handleEnter = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(openFull, BADGE_HOVER_DELAY_MS);
  }, [openFull]);

  const handleLeave = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    setShowFull(false);
  }, []);

  useLayoutEffect(() => {
    if (!showFull) return;
    const sync = () => {
      const el = rowRef.current;
      if (el) setAnchorRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [showFull]);

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        className={`group flex w-full items-center gap-2.5 rounded-lg border py-2 pl-2.5 pr-3 text-left transition ${
          selected
            ? "border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.08)]"
            : "border-border bg-surface-card hover:bg-surface-hover"
        }`}
        style={tint && !selected ? { backgroundImage: `linear-gradient(${tint}, ${tint})` } : undefined}
        onClick={() => onClick?.(vm.runId)}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={openFull}
        onBlur={handleLeave}
      >
        {/* 成员主题色竖条 —— 身份色标（替代挂绳） */}
        <span
          className="h-8 w-[2px] shrink-0 rounded-full"
          style={{ background: "rgb(var(--theme-color-rgb))" }}
          aria-hidden
        />
        <BadgeAvatar vm={vm} size={BADGE_COMPACT_AVATAR_PX} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-medium text-text-strong">{vm.name}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-text-faint">{vm.badgeSeq}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-text-muted">{vm.role}</div>
          <div className="mt-1.5">
            <PixelProgress progress={vm.progress} status={vm.status} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill status={vm.status} />
          <ModelPill provider={vm.provider} model={vm.model} />
        </div>
      </button>
      {showFull && anchorRect ? <FullBadgeCard vm={vm} anchorRect={anchorRect} /> : null}
    </>
  );
}

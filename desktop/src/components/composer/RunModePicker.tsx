import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Hand,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  RUN_MODE_OPTIONS,
  runModeLabel,
  type RunMode,
} from "../../constants/confirm-strategy-options";
import { useAppStore } from "../../store";
import { AllowAllConfirmDialog } from "./AllowAllConfirmDialog";

const RUN_MODE_ICON: Record<RunMode, typeof Hand> = {
  ask: Hand,
  allowlist: ShieldCheck,
  auto: TriangleAlert,
};

export type RunModePanelPlacement = "up" | "down";

/** 三档双行菜单的预估高度；下方够用就往下开，贴底再往上翻。 */
const RUN_MODE_MENU_HEIGHT = 180;

export function runModePanelStyle(rect: DOMRect): {
  style: CSSProperties;
  placement: RunModePanelPlacement;
} {
  const width = 260;
  const margin = 8;
  const gap = 6;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
  if (spaceBelow >= RUN_MODE_MENU_HEIGHT) {
    return {
      placement: "down",
      style: { position: "fixed", left, top: rect.bottom + gap, width, zIndex: 9999 },
    };
  }
  return {
    placement: "up",
    style: {
      position: "fixed",
      left,
      bottom: Math.max(margin, window.innerHeight - rect.top + gap),
      width,
      zIndex: 9999,
    },
  };
}

export type ApplyRunModeArgs = {
  next: RunMode;
  mode: RunMode;
  setRunMode: (v: RunMode) => void;
  persistRunMode?: (v: RunMode) => void | Promise<void>;
  confirmDialog?: (payload: {
    title?: string;
    message: string;
    detail?: string;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<{ confirmed: boolean }>;
};

export async function applyRunMode({
  next,
  mode,
  setRunMode,
  persistRunMode,
  confirmDialog,
}: ApplyRunModeArgs): Promise<void> {
  if (next === mode) return;
  if (next !== "auto") {
    setRunMode(next);
    await persistRunMode?.(next);
    return;
  }
  if (typeof confirmDialog !== "function") return;
  const dlg = await confirmDialog({
    title: `切换到${runModeLabel("auto")}？`,
    message: "之后将不再逐条询问，智能体可自行执行命令、改文件和访问网络。",
    detail: "工作区隔离仍然生效。可随时切回始终询问或按需确认。",
    confirmText: "切换",
    cancelText: "取消",
  });
  if (dlg.confirmed) {
    setRunMode("auto");
    await persistRunMode?.("auto");
  }
}

export function RunModeMenu({
  mode,
  onSelect,
  onCustomize,
}: {
  mode: RunMode;
  onSelect: (next: RunMode) => void;
  /** 传入时在菜单底部追加「自定义」入口；它不是第四个运行模式，只是跳转到安全中心。 */
  onCustomize?: () => void;
}) {
  return (
    <>
      {RUN_MODE_OPTIONS.map((option) => {
        const Icon = RUN_MODE_ICON[option.value];
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === mode}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover"
            onClick={() => onSelect(option.value)}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-tight text-text-primary">
                {option.label}
              </span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-faint">
                {option.description}
              </span>
            </span>
            {option.value === mode ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-text-strong" strokeWidth={2} />
            ) : null}
          </button>
        );
      })}
      {onCustomize ? (
        <>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover"
            onClick={onCustomize}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-tight text-text-primary">
                自定义…
              </span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-faint">
                路径、命令和工具的放行规则
              </span>
            </span>
          </button>
        </>
      ) : null}
    </>
  );
}

export function RunModePicker() {
  const mode = useAppStore((s) => s.runMode);
  const setRunMode = useAppStore((s) => s.setRunMode);
  const openSettings = useAppStore((s) => s.openSettings);
  const [open, setOpen] = useState(false);
  const [allowAllOpen, setAllowAllOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState<RunModePanelPlacement>("down");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const allowAllResolverRef = useRef<((value: { confirmed: boolean }) => void) | null>(null);
  const currentOption = RUN_MODE_OPTIONS.find((option) => option.value === mode) ?? RUN_MODE_OPTIONS[0]!;
  const Icon = RUN_MODE_ICON[currentOption.value];

  const syncPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const next = runModePanelStyle(el.getBoundingClientRect());
    setStyle(next.style);
    setPlacement(next.placement);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncPosition();
    const onReflow = () => syncPosition();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, syncPosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const closeAllowAll = (confirmed: boolean) => {
    setAllowAllOpen(false);
    allowAllResolverRef.current?.({ confirmed });
    allowAllResolverRef.current = null;
  };

  const applyMode = async (next: RunMode) => {
    setOpen(false);
    await applyRunMode({
      next,
      mode,
      setRunMode,
      persistRunMode: (value) => window.agenticxDesktop?.saveRunMode(value),
      confirmDialog: () =>
        new Promise<{ confirmed: boolean }>((resolve) => {
          allowAllResolverRef.current = resolve;
          setAllowAllOpen(true);
        }),
    });
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={anchorRef}
        type="button"
        className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors ${
          mode === "auto" ? "text-amber-500" : "text-text-subtle"
        } ${open ? "bg-surface-hover" : "hover:bg-surface-hover hover:text-text-primary"}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={currentOption.description}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{currentOption.label}</span>
        {open && placement === "up" ? (
          <ChevronUp className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="rounded-xl border border-border bg-surface-base p-1 shadow-2xl"
              style={style}
              role="listbox"
            >
              <RunModeMenu
                mode={mode}
                onSelect={(next) => void applyMode(next)}
                onCustomize={() => {
                  setOpen(false);
                  openSettings("security");
                }}
              />
            </div>,
            document.body,
          )
        : null}
      {allowAllOpen && typeof document !== "undefined"
        ? createPortal(
            <AllowAllConfirmDialog
              open
              onCancel={() => closeAllowAll(false)}
              onConfirm={() => closeAllowAll(true)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, ChevronDown, Cloud, Monitor } from "lucide-react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../store";
import {
  formatBackendChipLabel,
  getBackendScope,
  getConnectionModeSync,
} from "../../utils/backend-scope";

function panelStyle(rect: DOMRect): CSSProperties {
  const width = 200;
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  const top = rect.bottom + 6;
  return { position: "fixed", left, top, width, zIndex: 280 };
}

export function RunLocationPicker() {
  const openSettings = useAppStore((s) => s.openSettings);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return window.agenticxDesktop?.onConnectionModeChanged?.(() => {
      setTick((n) => n + 1);
    });
  }, []);

  void tick;
  const connectionMode = getConnectionModeSync();
  const backendScope = getBackendScope();
  const label = formatBackendChipLabel(backendScope, connectionMode);

  const syncPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setStyle(panelStyle(el.getBoundingClientRect()));
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

  const applyMode = async (next: "local" | "remote") => {
    setOpen(false);
    if (next === connectionMode) return;
    const desktop = window.agenticxDesktop;
    if (typeof desktop?.loadRemoteServer !== "function" || typeof desktop.saveRemoteServer !== "function") {
      openSettings("server");
      return;
    }
    const current = await desktop.loadRemoteServer();
    const url = String(current.url ?? "").trim().replace(/\/+$/, "");
    const token = String(current.token ?? "").trim();
    if (next === "remote" && !url) {
      openSettings("server");
      return;
    }
    const remoteSave = await desktop.saveRemoteServer({
      enabled: next === "remote",
      url,
      token,
    });
    if (remoteSave.mode_changed && typeof desktop.confirmDialog === "function") {
      const restartDlg = await desktop.confirmDialog({
        title: "需要重启 Near",
        message: "连接模式已切换，需要重启 Near 以加载新后端工作区。",
        detail: "会话、窗格、分身与 MCP 状态将按新后端隔离，不会与上一套后端混用。",
        confirmText: "立即重启",
        cancelText: "稍后手动重启",
      });
      if (restartDlg.confirmed) {
        await desktop.appRelaunch();
      }
    }
  };

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-lg px-2 text-[12px] text-text-subtle transition-colors ${
          open ? "bg-surface-hover text-text-strong" : "hover:bg-surface-hover hover:text-text-primary"
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={connectionMode === "remote" ? `当前连接到远程后端 ${backendScope}` : "当前使用本机 agx serve"}
      >
        {connectionMode === "remote" ? (
          <Cloud className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        ) : (
          <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        )}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="rounded-xl border border-border bg-surface-base p-1 shadow-2xl"
              style={style}
              role="listbox"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                onClick={() => void applyMode("local")}
              >
                <Monitor className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
                <span className="min-w-0 flex-1">本地</span>
                {connectionMode === "local" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-text-strong" strokeWidth={2} />
                ) : null}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                onClick={() => void applyMode("remote")}
              >
                <Cloud className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
                <span className="min-w-0 flex-1">远程</span>
                {connectionMode === "remote" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-text-strong" strokeWidth={2} />
                ) : null}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

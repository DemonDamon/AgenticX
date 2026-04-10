import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppStore, type PaneTerminalTab, type ThemeMode } from "../store";

type Props = {
  tabId: string;
  cwd: string;
  ccBridgePty?: PaneTerminalTab["ccBridgePty"];
};

/** Read the computed background color of the nearest ancestor with a solid bg. */
function samplePanelBg(el: HTMLElement): string {
  const style = getComputedStyle(el);
  const bg = style.backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
    return bg;
  }
  if (el.parentElement) {
    return samplePanelBg(el.parentElement);
  }
  return "#0a0e14";
}

/** Convert any CSS color string to a #rrggbb hex. */
function toHex(cssColor: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return cssColor;
  ctx.fillStyle = cssColor;
  return ctx.fillStyle;
}

function getTerminalAnsi(theme: ThemeMode) {
  if (theme === "light") {
    return {
      foreground: "#1e293b",
      cursor: "#334155",
      cursorAccent: "#f8fafc",
      selectionBackground: "rgba(30, 41, 59, 0.22)",
      black: "#1e293b",
      red: "#dc2626",
      green: "#16a34a",
      yellow: "#ca8a04",
      blue: "#2563eb",
      magenta: "#9333ea",
      cyan: "#0891b2",
      white: "#e2e8f0",
      brightBlack: "#64748b",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#a855f7",
      brightCyan: "#06b6d4",
      brightWhite: "#0f172a",
    };
  }
  if (theme === "dim") {
    return {
      foreground: "#d9dce1",
      cursor: "#b8c0cc",
      cursorAccent: "#12161f",
      selectionBackground: "rgba(217, 220, 225, 0.18)",
      black: "#0b0f16",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#cbd5e1",
      brightBlack: "#64748b",
      brightRed: "#fb7185",
      brightGreen: "#86efac",
      brightYellow: "#fcd34d",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f8fafc",
    };
  }
  return {
    foreground: "#e4e4e7",
    cursor: "#a1a1aa",
    cursorAccent: "#0a0e14",
    selectionBackground: "rgba(228, 228, 231, 0.16)",
    black: "#0a0b0f",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#d4d4d8",
    brightBlack: "#71717a",
    brightRed: "#fb7185",
    brightGreen: "#86efac",
    brightYellow: "#fcd34d",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#fafafa",
  };
}

function newPtySessionId(tabId: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${tabId}:${suffix}`;
}

export function TerminalEmbed({ tabId, cwd, ccBridgePty }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const themeMode = useAppStore((s) => s.theme);
  const [exited, setExited] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  // Increment to force re-spawn
  const [spawnGen, setSpawnGen] = useState(0);
  // Track whether spawn has completed successfully at least once this mount
  const spawnedRef = useRef(false);
  // Timer for debouncing exit signal
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restart = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExited(false);
    setSpawnError(null);
    spawnedRef.current = false;
    setSpawnGen((g) => g + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Unique id per effect run so kill/exit from a previous session never matches
    // this listener (fixes Strict Mode + parent re-render races).
    const ptySessionId = ccBridgePty
      ? `${tabId}:bridge:${ccBridgePty.sessionId.trim()}`
      : newPtySessionId(tabId);

    setExited(false);
    setSpawnError(null);
    spawnedRef.current = false;

    const panelBg = toHex(samplePanelBg(el));
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: { background: panelBg, ...getTerminalAnsi(themeMode) },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    let disposed = false;
    const scheduleFit = () => {
      try { fit.fit(); } catch { /* ignore */ }
    };
    scheduleFit();

    const ro = new ResizeObserver(() => {
      scheduleFit();
      void window.agenticxDesktop.terminalResize({
        id: ptySessionId,
        cols: term.cols,
        rows: term.rows,
      });
    });
    ro.observe(el);

    const offData = window.agenticxDesktop.onTerminalData((payload) => {
      if (payload.id !== ptySessionId) return;
      term.write(payload.data);
    });

    const offExit = window.agenticxDesktop.onTerminalExit((payload) => {
      if (payload.id !== ptySessionId) return;
      if (disposed) return;
      // Only show the exit overlay if spawn had already succeeded.
      // This prevents a stale exit event (from a previous session being killed)
      // from immediately showing the overlay right after mount.
      if (!spawnedRef.current) return;
      // Debounce: ignore spurious exit events fired within 300ms
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        if (!disposed) setExited(true);
      }, 300);
    });

    const dSub = term.onData((data) => {
      void window.agenticxDesktop.terminalWrite({ id: ptySessionId, data });
    });

    void (async () => {
      scheduleFit();
      if (ccBridgePty) {
        const res = await window.agenticxDesktop.terminalBridgeAttach({
          id: ptySessionId,
          sessionId: ccBridgePty.sessionId.trim(),
          baseUrl: ccBridgePty.baseUrl.trim().replace(/\/$/, ""),
          token: ccBridgePty.token,
          cols: term.cols,
          rows: term.rows,
        });
        if (disposed) return;
        if (!res.ok) {
          setSpawnError(res.error ?? "无法连接到 cc-bridge PTY 流");
          return;
        }
        spawnedRef.current = true;
        scheduleFit();
        void window.agenticxDesktop.terminalResize({
          id: ptySessionId,
          cols: term.cols,
          rows: term.rows,
        });
        return;
      }
      const res = await window.agenticxDesktop.terminalSpawn({
        id: ptySessionId,
        cwd,
        cols: term.cols,
        rows: term.rows,
      });
      if (disposed) return;
      if (!res.ok) {
        setSpawnError(res.error ?? "unknown error");
        return;
      }
      spawnedRef.current = true;
      scheduleFit();
      void window.agenticxDesktop.terminalResize({
        id: ptySessionId,
        cols: term.cols,
        rows: term.rows,
      });
    })();

    return () => {
      disposed = true;
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      ro.disconnect();
      offData();
      offExit();
      dSub.dispose();
      void window.agenticxDesktop.terminalKill(ptySessionId);
      term.dispose();
      termRef.current = null;
    };
  // spawnGen drives re-mount / re-spawn when user clicks restart
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, cwd, spawnGen, ccBridgePty?.sessionId, ccBridgePty?.baseUrl, ccBridgePty?.token]);

  useEffect(() => {
    if (!termRef.current || !containerRef.current) return;
    const panelBg = toHex(samplePanelBg(containerRef.current));
    termRef.current.options.theme = { background: panelBg, ...getTerminalAnsi(themeMode) };
  }, [themeMode]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden px-1 py-1" />
      {(exited || spawnError) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-card backdrop-blur-sm">
          <span className="text-xs text-status-warning">
            {spawnError ? `无法启动终端：${spawnError}` : "终端已退出"}
          </span>
          <button
            type="button"
            onClick={restart}
            className="rounded border border-border px-3 py-1 text-xs text-text-subtle hover:border-text-subtle hover:text-text-primary"
          >
            重新启动
          </button>
        </div>
      )}
    </div>
  );
}

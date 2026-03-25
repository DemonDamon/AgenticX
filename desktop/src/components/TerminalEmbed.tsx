import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
  tabId: string;
  cwd: string;
};

function newPtySessionId(tabId: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${tabId}:${suffix}`;
}

export function TerminalEmbed({ tabId, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
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
    const ptySessionId = newPtySessionId(tabId);

    setExited(false);
    setSpawnError(null);
    spawnedRef.current = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0f1014",
        foreground: "#e4e4e7",
        cursor: "#a1a1aa",
      },
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
  }, [tabId, cwd, spawnGen]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden px-1 py-1" />
      {(exited || spawnError) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f1014]/90">
          <span className="text-xs text-yellow-400">
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

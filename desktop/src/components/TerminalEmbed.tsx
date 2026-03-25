import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
  tabId: string;
  cwd: string;
};

export function TerminalEmbed({ tabId, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exited, setExited] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  // Increment to force re-spawn
  const [spawnGen, setSpawnGen] = useState(0);

  const restart = useCallback(() => {
    setExited(false);
    setSpawnError(null);
    setSpawnGen((g) => g + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setExited(false);
    setSpawnError(null);

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
        id: tabId,
        cols: term.cols,
        rows: term.rows,
      });
    });
    ro.observe(el);

    const offData = window.agenticxDesktop.onTerminalData((payload) => {
      if (payload.id !== tabId) return;
      term.write(payload.data);
    });
    const offExit = window.agenticxDesktop.onTerminalExit((payload) => {
      if (payload.id !== tabId) return;
      if (!disposed) setExited(true);
    });

    const dSub = term.onData((data) => {
      void window.agenticxDesktop.terminalWrite({ id: tabId, data });
    });

    void (async () => {
      scheduleFit();
      const res = await window.agenticxDesktop.terminalSpawn({
        id: tabId,
        cwd,
        cols: term.cols,
        rows: term.rows,
      });
      if (disposed) return;
      if (!res.ok) {
        setSpawnError(res.error ?? "unknown error");
        return;
      }
      scheduleFit();
      void window.agenticxDesktop.terminalResize({
        id: tabId,
        cols: term.cols,
        rows: term.rows,
      });
    })();

    return () => {
      disposed = true;
      ro.disconnect();
      offData();
      offExit();
      dSub.dispose();
      void window.agenticxDesktop.terminalKill(tabId);
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

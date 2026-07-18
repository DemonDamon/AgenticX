import { useEffect, useState } from "react";
import { formatBackendChipLabel, getBackendScope, getConnectionModeSync } from "../utils/backend-scope";

/** Small pill showing 本地/远程 backend connection mode; shared by Topbar and the expanded sidebar's top row. */
export function BackendModeChip() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return window.agenticxDesktop?.onConnectionModeChanged?.(() => {
      setTick((n) => n + 1);
    });
  }, []);

  // Re-read on each render and when main notifies mode changes.
  void tick;
  const connectionMode = getConnectionModeSync();
  const backendScope = getBackendScope();
  const label = formatBackendChipLabel(backendScope, connectionMode);
  const tooltip =
    connectionMode === "remote"
      ? `当前连接到远程后端 ${backendScope}。到「设置 → 服务器」可切换。`
      : "当前使用本机 agx serve。到「设置 → 服务器」可切换远程模式。";

  return (
    <span
      className="inline-flex max-w-[140px] items-center gap-1.5 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[11px] text-text-subtle"
      title={tooltip}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          connectionMode === "remote" ? "bg-sky-400" : "bg-emerald-400"
        }`}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

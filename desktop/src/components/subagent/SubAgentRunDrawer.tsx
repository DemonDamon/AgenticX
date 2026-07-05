/**
 * Sub-Plan D — right-column drawer: badge header + activity timeline + artifacts.
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { PanelRightClose } from "lucide-react";
import type { SubAgent } from "../../store";
import { AgentBadgeDrawerHeader } from "./AgentBadge";
import {
  fromLiveSubAgent,
  fromRunRecord,
  mergeBadgeVMs,
  type BadgeVM,
  type SubAgentRunRecord,
} from "./badge-vm";
import { fetchRunDetail } from "./run-drawer-api";
import { RunActivityTimeline } from "./RunActivityTimeline";
import { RunArtifactList } from "./RunArtifactList";

type Props = {
  width: number;
  sessionId: string;
  runId: string;
  liveSubAgent?: SubAgent;
  apiBase: string;
  apiToken: string;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
  tintColor?: string;
};

export function SubAgentRunDrawer({
  width,
  sessionId,
  runId,
  liveSubAgent,
  apiBase,
  apiToken,
  onResizeStart,
  onClose,
  tintColor,
}: Props) {
  const [runRecord, setRunRecord] = useState<SubAgentRunRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const badgeVm: BadgeVM | null = useMemo(() => {
    const persisted = runRecord ? [fromRunRecord(runRecord)] : [];
    const live = liveSubAgent ? [fromLiveSubAgent(liveSubAgent)] : [];
    const merged = mergeBadgeVMs(persisted, live);
    return merged[0] ?? (liveSubAgent ? fromLiveSubAgent(liveSubAgent) : null);
  }, [runRecord, liveSubAgent]);

  const isRunning = useMemo(() => {
    const status = badgeVm?.status ?? liveSubAgent?.status ?? "";
    return status === "running" || status === "pending" || status === "awaiting_confirm" || status === "awaiting_input";
  }, [badgeVm?.status, liveSubAgent?.status]);

  const refreshRun = useCallback(async () => {
    if (!apiBase || !apiToken || !sessionId || !runId) return;
    setLoadingRun(true);
    setLoadError(null);
    try {
      const resp = await fetchRunDetail(apiBase, apiToken, sessionId, runId);
      if (!resp.ok) {
        if (liveSubAgent) {
          setRunRecord(null);
          setLoadError(null);
          return;
        }
        setLoadError(resp.error || resp.detail || "无法加载 run 详情");
        return;
      }
      if (resp.run) {
        setRunRecord(resp.run as SubAgentRunRecord);
      }
    } catch (err) {
      if (!liveSubAgent) setLoadError(String(err));
    } finally {
      setLoadingRun(false);
    }
  }, [apiBase, apiToken, sessionId, runId, liveSubAgent]);

  useEffect(() => {
    void refreshRun();
  }, [refreshRun]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void refreshRun();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isRunning, refreshRun]);

  const handleCopy = useCallback(() => {
    if (!badgeVm) return;
    const header = [
      `智能体: ${badgeVm.name} (${badgeVm.runId})`,
      `角色: ${badgeVm.role}`,
      badgeVm.model ? `模型: ${badgeVm.model}` : "",
      `状态: ${badgeVm.status}`,
      badgeVm.resultSummary ? `产出: ${badgeVm.resultSummary}` : "",
      badgeVm.resultFile ? `落盘: ${badgeVm.resultFile}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard.writeText(header).then(() => {
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 1500);
    });
  }, [badgeVm]);

  const resultFile = badgeVm?.resultFile ?? liveSubAgent?.resultFile;
  const outputFiles = badgeVm?.outputFiles ?? liveSubAgent?.outputFiles;
  const liveEvents = liveSubAgent?.events ?? [];

  return (
    <div
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-surface-card"
      style={{ width, ...(tintColor ? { backgroundColor: tintColor } : {}) }}
    >
      <div
        className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
        onMouseDown={onResizeStart}
        title="拖拽调整落盘面板宽度"
      >
        <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-xs text-text-subtle">子智能体落盘</span>
        <button
          type="button"
          className="agx-topbar-btn !px-[5px]"
          onClick={onClose}
          title="关闭落盘面板"
        >
          <PanelRightClose className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>
      {loadingRun && !badgeVm ? (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="h-16 animate-pulse rounded-lg bg-surface-hover" />
          <div className="flex-1 animate-pulse rounded-lg bg-surface-hover" />
        </div>
      ) : loadError && !badgeVm ? (
        <div className="p-3 text-[12px] text-amber-200">{loadError}</div>
      ) : badgeVm ? (
        <>
          <AgentBadgeDrawerHeader vm={badgeVm} onCopy={handleCopy} copyFeedback={copyFeedback} />
          <RunActivityTimeline
            apiBase={apiBase}
            apiToken={apiToken}
            sessionId={sessionId}
            runId={runId}
            isRunning={isRunning}
            liveEvents={liveEvents}
          />
          <RunArtifactList
            apiBase={apiBase}
            apiToken={apiToken}
            sessionId={sessionId}
            runId={runId}
            resultFile={resultFile}
            outputFiles={outputFiles}
          />
        </>
      ) : null}
    </div>
  );
}

import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { PanelRightClose, Bot } from "lucide-react";
import type { SubAgent } from "../store";
import { SubAgentCard } from "./SubAgentCard";
import { SubAgentClusterCard, fromLiveSubAgent } from "./subagent";

type Props = {
  width: number;
  /** Backend chat session id; shown truncated so users can tell which pane owns these spawns. */
  sessionId?: string;
  subAgents: SubAgent[];
  selectedSubAgent: string | null;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onModelChange?: (agentId: string, provider: string, model: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
  tintColor?: string;
};

export function SpawnsColumn({
  width,
  sessionId,
  subAgents,
  selectedSubAgent,
  onResizeStart,
  onClose,
  onCancel,
  onRetry,
  onChat,
  onModelChange,
  onConfirmResolve,
  tintColor,
}: Props) {
  // 集群概览：把当前会话的多个子智能体聚合为一张 Near 集群卡片（默认折叠），
  // 作为列表上方的快速总览；点击成员复用既有选中 / 对话交互（onChat）。
  const clusterMembers = useMemo(
    () => subAgents.map((s, i) => fromLiveSubAgent(s, i)),
    [subAgents],
  );
  return (
    <div className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-surface-card" style={{ width, ...(tintColor ? { backgroundColor: tintColor } : {}) }}>
      <div
        className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
        onMouseDown={onResizeStart}
        title="拖拽调整 Spawns 列宽度"
      >
        <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="flex items-center gap-1.5 text-xs text-text-subtle">
          <Bot className="h-[18px] w-[18px]" strokeWidth={1.8} />
          {subAgents.length > 0 && <span className="text-[11px] opacity-60">{subAgents.length}</span>}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[10px] text-text-faint" title={sessionId || undefined}>
            当前会话
            {sessionId && sessionId.length > 6 ? ` · ${sessionId.slice(0, 8)}…` : sessionId ? ` · ${sessionId}` : ""}
          </span>
          <button
            type="button"
            className="agx-topbar-btn !px-[5px]"
            onClick={onClose}
            title="收起 Spawns 列"
          >
            <PanelRightClose className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {subAgents.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-card px-2 py-3 text-xs text-text-faint">
            当前会话还没有派生子智能体
          </div>
        ) : (
          <>
          {clusterMembers.length >= 2 ? (
            <SubAgentClusterCard
              members={clusterMembers}
              selectedRunId={selectedSubAgent}
              onOpenRun={onChat}
            />
          ) : null}
          {subAgents.map((subAgent) => (
            <SubAgentCard
              key={subAgent.id}
              subAgent={subAgent}
              selected={selectedSubAgent === subAgent.id}
              onCancel={onCancel}
              onRetry={onRetry}
              onChat={onChat}
              onModelChange={onModelChange}
              onConfirmResolve={onConfirmResolve}
            />
          ))}
          </>
        )}
      </div>
    </div>
  );
}

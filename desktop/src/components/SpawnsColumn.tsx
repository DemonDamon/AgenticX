import type { MouseEvent as ReactMouseEvent } from "react";
import type { SubAgent } from "../store";
import { SubAgentCard } from "./SubAgentCard";

type Props = {
  width: number;
  subAgents: SubAgent[];
  selectedSubAgent: string | null;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onSelect: (agentId: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
};

export function SpawnsColumn({
  width,
  subAgents,
  selectedSubAgent,
  onResizeStart,
  onClose,
  onCancel,
  onRetry,
  onChat,
  onSelect,
  onConfirmResolve,
}: Props) {
  return (
    <div className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-surface-card" style={{ width }}>
      <div
        className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
        onMouseDown={onResizeStart}
        title="拖拽调整 Spawns 列宽度"
      >
        <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90"
          style={{ borderColor: "var(--ui-accent-divider-hover)" }}
        />
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-xs text-text-subtle">Spawns ({subAgents.length})</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-faint">当前会话</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
            title="收起 Spawns 列"
          >
            关闭
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {subAgents.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-card px-2 py-3 text-xs text-text-faint">
            当前会话还没有派生子智能体
          </div>
        ) : (
          subAgents.map((subAgent) => (
            <SubAgentCard
              key={subAgent.id}
              subAgent={subAgent}
              selected={selectedSubAgent === subAgent.id}
              onCancel={onCancel}
              onRetry={onRetry}
              onChat={onChat}
              onSelect={onSelect}
              onConfirmResolve={onConfirmResolve}
            />
          ))
        )}
      </div>
    </div>
  );
}

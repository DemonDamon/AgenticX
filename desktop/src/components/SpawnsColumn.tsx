import type { MouseEvent as ReactMouseEvent } from "react";
import type { SubAgent } from "../store";
import { SubAgentCard } from "./SubAgentCard";

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
  onSelect: (agentId: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
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
        <span className="flex items-center gap-1.5 text-xs text-text-subtle">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="6" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M6 6V4.5A2 2 0 0 1 10 4.5V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="5.5" cy="9.5" r="0.8" fill="currentColor"/>
            <circle cx="10.5" cy="9.5" r="0.8" fill="currentColor"/>
            <path d="M1.5 8.5V10.5M14.5 8.5V10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M6 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          {subAgents.length > 0 && <span className="text-[11px] opacity-60">{subAgents.length}</span>}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[10px] text-text-faint" title={sessionId || undefined}>
            当前会话
            {sessionId && sessionId.length > 6 ? ` · ${sessionId.slice(0, 8)}…` : sessionId ? ` · ${sessionId}` : ""}
          </span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
            title="收起 Spawns 列"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
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

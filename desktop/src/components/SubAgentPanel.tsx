import type { SubAgent } from "../store";
import { SubAgentCard } from "./SubAgentCard";

type Props = {
  open: boolean;
  subAgents: SubAgent[];
  selectedSubAgent: string | null;
  onToggle: () => void;
  onCancel: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onSelect: (agentId: string) => void;
};

export function SubAgentPanel({
  open,
  subAgents,
  selectedSubAgent,
  onToggle,
  onCancel,
  onRetry,
  onChat,
  onSelect
}: Props) {
  const running = subAgents.filter((item) => item.status === "running").length;
  const done = subAgents.filter((item) => item.status === "completed").length;
  const pending = subAgents.filter((item) => item.status === "pending").length;

  return (
    <aside
      className={`h-full border-l border-border/60 bg-slate-900/55 transition-all duration-200 ${
        open ? "w-[300px] min-w-[280px] max-w-[320px]" : "w-11"
      }`}
    >
      <div className="flex h-11 items-center justify-between border-b border-border/60 px-2">
        <button className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700" onClick={onToggle}>
          {open ? "收起" : "队列"}
        </button>
        {open ? <span className="text-xs text-slate-400">Team</span> : null}
      </div>

      {open ? (
        <div className="flex h-[calc(100%-44px)] flex-col">
          <div className="border-b border-border/60 px-3 py-2 text-xs text-slate-400">
            <span className="mr-2">运行 {running}</span>
            <span className="mr-2">完成 {done}</span>
            <span>等待 {pending}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {subAgents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 p-3 text-xs text-slate-500">
                暂无子智能体
              </div>
            ) : (
              subAgents.map((subAgent) => (
                <SubAgentCard
                  key={subAgent.id}
                  subAgent={subAgent}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onChat={onChat}
                  onSelect={onSelect}
                  selected={selectedSubAgent === subAgent.id}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

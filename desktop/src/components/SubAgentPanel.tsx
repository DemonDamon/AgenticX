import { useTranslation } from "react-i18next";
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
  onModelChange?: (agentId: string, provider: string, model: string) => void;
  onConfirmResolve?: (agentId: string, approved: boolean) => void;
};

export function SubAgentPanel({
  open,
  subAgents,
  selectedSubAgent,
  onToggle,
  onCancel,
  onRetry,
  onChat,
  onModelChange,
  onConfirmResolve,
}: Props) {
  const { t } = useTranslation("chat");
  const running = subAgents.filter((item) => item.status === "running").length;
  const done = subAgents.filter((item) => item.status === "completed").length;
  const pending = subAgents.filter((item) => item.status === "pending").length;
  const awaitingConfirm = subAgents.filter((item) => item.status === "awaiting_confirm").length;
  const awaitingInput = subAgents.filter((item) => item.status === "awaiting_input").length;

  return (
    <aside
      className={`agx-subagent-panel ${open ? "" : "is-collapsed"}`}
    >
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <button className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-hover" onClick={onToggle}>
          {open ? t("subagent.panelCollapse") : t("subagent.panelQueue")}
        </button>
        {open ? <span className="text-xs text-text-faint">{t("subagent.team")}</span> : null}
      </div>

      {open ? (
        <div className="flex h-[calc(100%-44px)] flex-col">
          <div className="border-b border-border px-3 py-2 text-xs text-text-faint">
            <span className="mr-2">{t("subagent.runningCount", { count: running })}</span>
            <span className="mr-2">{t("subagent.doneCount", { count: done })}</span>
            <span className="mr-2">{t("subagent.pendingCount", { count: pending })}</span>
            <span className="mr-2">{t("subagent.awaitingConfirmCount", { count: awaitingConfirm })}</span>
            <span>{t("subagent.awaitingInputCount", { count: awaitingInput })}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {subAgents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-text-faint">
                {t("subagent.empty")}
              </div>
            ) : (
              subAgents.map((subAgent) => (
                <SubAgentCard
                  key={subAgent.id}
                  subAgent={subAgent}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onChat={onChat}
                  onModelChange={onModelChange}
                  onConfirmResolve={onConfirmResolve}
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

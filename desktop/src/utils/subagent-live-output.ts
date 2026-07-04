import { useAppStore } from "../store";
import { isThinkingPlaceholderText, stripThinkingTags } from "./stream-overlay-policy";

/** Persist pending subagent token buffer as a reasoning event, then clear liveOutput. */
export function flushSubAgentLiveOutput(agentId: string): void {
  const { subAgents, addSubAgentEvent, updateSubAgent } = useAppStore.getState();
  const sub = subAgents.find((item) => item.id === agentId);
  const pending = (sub?.liveOutput ?? "").trim();
  if (pending && !isThinkingPlaceholderText(pending)) {
    const cleaned = stripThinkingTags(pending);
    if (cleaned) {
      addSubAgentEvent(agentId, { type: "reasoning", content: cleaned });
    }
  }
  updateSubAgent(agentId, { liveOutput: "" });
}

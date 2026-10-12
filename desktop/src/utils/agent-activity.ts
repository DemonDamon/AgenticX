import type { SubAgentStatus } from "../store";

export type AgentActivitySummary = {
  running: number;
  awaitingConfirm: number;
  awaitingInput: number;
  active: number;
};

export function summarizeAgentActivity(items: ReadonlyArray<{ status: SubAgentStatus }>): AgentActivitySummary {
  let running = 0;
  let awaitingConfirm = 0;
  let awaitingInput = 0;
  for (const item of items) {
    if (item.status === "running" || item.status === "pending") running += 1;
    else if (item.status === "awaiting_confirm") awaitingConfirm += 1;
    else if (item.status === "awaiting_input") awaitingInput += 1;
  }
  return { running, awaitingConfirm, awaitingInput, active: running + awaitingConfirm + awaitingInput };
}

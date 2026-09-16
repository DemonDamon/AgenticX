import type { TFunction } from "i18next";

const EVENT_LABEL_KEYS = {
  round_started: "replay.event.roundStarted",
  run_resumed: "replay.event.runResumed",
  user_message: "replay.event.userMessage",
  assistant_output_started: "replay.event.assistantOutputStarted",
  assistant_output_completed: "replay.event.assistantOutputCompleted",
  run_started: "replay.event.runStarted",
  run_completed: "replay.event.runCompleted",
  ledger_gap: "replay.event.ledgerGap",
  confirm_required: "replay.event.confirmRequired",
  confirmation_required: "replay.event.confirmRequired",
  confirm_response: "replay.event.confirmResponse",
  confirmation_response: "replay.event.confirmResponse",
  clarification_required: "replay.event.clarificationRequired",
  clarify_required: "replay.event.clarificationRequired",
  clarification_response: "replay.event.clarificationResponse",
  clarify_response: "replay.event.clarificationResponse",
  clarification_suspended: "replay.event.clarificationSuspended",
  clarify_suspended: "replay.event.clarificationSuspended",
  artifact: "replay.event.artifact",
  error: "replay.event.error",
  tool_call: "replay.event.toolCall",
  tool_progress: "replay.event.toolProgress",
  tool_result: "replay.event.toolResult",
  subagent_started: "replay.event.subagentStarted",
  subagent_progress: "replay.event.subagentProgress",
  subagent_checkpoint: "replay.event.subagentCheckpoint",
  subagent_completed: "replay.event.subagentCompleted",
  subagent_error: "replay.event.subagentError",
  compaction: "replay.event.compaction",
  context_stats: "replay.event.contextStats",
  stall: "replay.event.stall",
} as const satisfies Record<string, string>;

function humanizeEventType(eventType: string): string {
  const readable = eventType
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return readable || "unknown";
}

export function formatReplayEventLabel(
  eventType: string,
  t: TFunction<"workspace">,
): string {
  const key = EVENT_LABEL_KEYS[eventType as keyof typeof EVENT_LABEL_KEYS];
  if (key) return t(key);
  return t("replay.event.unknown", { type: humanizeEventType(eventType) });
}

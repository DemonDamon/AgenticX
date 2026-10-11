import type { Message } from "../store";
import { parseChoicePanelFields, parseClarificationDecisions } from "./clarification-notice";

export function parseClarificationToolArgs(toolArgs: Record<string, unknown>) {
  const cleanPrompt = String(toolArgs.prompt ?? "").trim();
  const titleFallback = String(toolArgs.title ?? "").trim();
  if (!cleanPrompt && !titleFallback) return null;
  const resolvedPrompt = cleanPrompt || titleFallback;
  const options = Array.isArray(toolArgs.options)
    ? (toolArgs.options as unknown[])
        .map((o) => {
          if (o && typeof o === "object" && "label" in (o as object)) {
            return String((o as { label?: unknown }).label ?? "").trim();
          }
          return String(o).trim();
        })
        .filter(Boolean)
    : [];
  const allowFreeText = toolArgs.allow_free_text !== false;
  const context =
    toolArgs.context && typeof toolArgs.context === "object"
      ? (toolArgs.context as Record<string, unknown>)
      : undefined;
  return { prompt: resolvedPrompt, options, allowFreeText, context };
}

export function buildClarificationPromptFromToolArgs(
  toolArgs: Record<string, unknown>,
  toolCallId: string,
  sessionId: string,
  requestId?: string,
) {
  const parsed = parseClarificationToolArgs(toolArgs);
  if (!parsed) return null;
  const decisions = parseClarificationDecisions(toolArgs.decisions);
  const choiceFields = parseChoicePanelFields(parsed.context);
  return {
    requestId: requestId ?? `pending:${toolCallId}`,
    prompt: parsed.prompt,
    options: parsed.options,
    decisions: decisions.length > 0 ? decisions : undefined,
    allowFreeText: parsed.allowFreeText,
    agentId: "meta",
    sessionId,
    context: parsed.context,
    ...choiceFields,
  } satisfies NonNullable<Message["clarificationPrompt"]>;
}

export function buildClarificationMessageExtras(
  toolArgs: Record<string, unknown>,
  toolCallId: string,
  toolGroupId: string,
  sessionId: string,
  requestId?: string,
) {
  const parsed = parseClarificationToolArgs(toolArgs);
  if (!parsed) return null;
  const clarificationPrompt = buildClarificationPromptFromToolArgs(
    toolArgs,
    toolCallId,
    sessionId,
    requestId,
  );
  if (!clarificationPrompt) return null;
  const toolName =
    toolArgs && typeof toolArgs === "object" && "panel_type" in toolArgs
      ? "present_choices"
      : "request_clarification";
  return {
    toolCallId,
    toolName,
    toolArgs,
    toolStatus: "running" as const,
    toolGroupId,
    clarificationPrompt,
    metadata: {
      kind: "clarification",
      request_id: clarificationPrompt.requestId,
      prompt: parsed.prompt,
      options: parsed.options,
      decisions: clarificationPrompt.decisions,
      allow_free_text: parsed.allowFreeText,
      context: parsed.context,
    },
  };
}

export function findRunningClarificationToolMessage(messages: Message[]) {
  return [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === "tool" &&
        (m.toolName === "request_clarification" || m.toolName === "present_choices") &&
        Boolean(m.toolCallId) &&
        (m.toolStatus === "running" || m.toolStatus === "pending"),
    );
}

/** Locate the in-flight request_action_confirmation tool row for SSE patching. */
export function findRunningActionConfirmationToolMessage(messages: Message[]) {
  return [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === "tool" &&
        m.toolName === "request_action_confirmation" &&
        Boolean(m.toolCallId) &&
        (m.toolStatus === "running" || m.toolStatus === "pending"),
    );
}

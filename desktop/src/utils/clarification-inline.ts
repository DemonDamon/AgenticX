import type { Message } from "../store";
import { parseClarificationDecisions } from "./clarification-notice";

export function parseClarificationToolArgs(toolArgs: Record<string, unknown>) {
  const prompt = String(toolArgs.prompt ?? "").trim();
  if (!prompt) return null;
  const options = Array.isArray(toolArgs.options)
    ? (toolArgs.options as unknown[]).map((o) => String(o)).filter(Boolean)
    : [];
  const allowFreeText = toolArgs.allow_free_text !== false;
  const context =
    toolArgs.context && typeof toolArgs.context === "object"
      ? (toolArgs.context as Record<string, unknown>)
      : undefined;
  return { prompt, options, allowFreeText, context };
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
  return {
    requestId: requestId ?? `pending:${toolCallId}`,
    prompt: parsed.prompt,
    options: parsed.options,
    decisions: decisions.length > 0 ? decisions : undefined,
    allowFreeText: parsed.allowFreeText,
    agentId: "meta",
    sessionId,
    context: parsed.context,
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
  return {
    toolCallId,
    toolName: "request_clarification",
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
        m.toolName === "request_clarification" &&
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

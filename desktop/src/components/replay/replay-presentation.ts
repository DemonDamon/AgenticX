import type { ReplayEvent, ReplayRun, ReplaySpeed } from "./replay-types";

export type PresentationMessage = {
  id: string;
  role: string;
  content?: string;
  timestamp?: number;
  toolCallId?: string;
  toolStatus?: string;
  systemNotice?: boolean;
  blocks?: unknown;
};

export type PresentationBinding = {
  revealSeq: Map<string, number>;
  startedSeq: Map<string, number>;
  completeSeq: Map<string, number>;
  prefixIds: Set<string>;
  afterIds: Set<string>;
  unmatchedInRunIds: Set<string>;
  canPresent: boolean;
};

export type PresentationGate = {
  ok: boolean;
  reason?: "running" | "no_run" | "unaligned";
};

const PRESENTATION_BEATS = new Set([
  "user_message",
  "assistant_output_started",
  "assistant_output_completed",
  "tool_call",
  "tool_result",
  "confirm_required",
  "confirm_response",
  "clarification_required",
  "clarification_response",
  "error",
  "stall",
  "subagent_error",
  "artifact",
  "subagent_started",
  "subagent_completed",
  "run_completed",
]);

const TERMINAL_RUN = new Set<ReplayRun["status"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const DWELL_MS: Record<string, number> = {
  user_message: 300,
  assistant_output_completed: 1_200,
  error: 1_500,
  stall: 1_500,
  subagent_error: 1_500,
};

const DEFAULT_DWELL_MS = 400;
const INSTANT_DWELL_MS = 80;

export function isPresentationBeat(type: string): boolean {
  return PRESENTATION_BEATS.has(type);
}

export function nextPresentationBeat<T extends { seq: number; type: string }>(
  events: readonly T[],
  afterSeq: number,
): T | undefined {
  return events.find((item) => item.seq > afterSeq && isPresentationBeat(item.type));
}

export function previousPresentationBeat<T extends { seq: number; type: string }>(
  events: readonly T[],
  beforeSeq: number,
): T | undefined {
  return [...events].reverse().find((item) => (
    item.seq < beforeSeq && isPresentationBeat(item.type)
  ));
}

export function presentationDwellMs(type: string, speed: ReplaySpeed): number {
  if (speed === "instant") return INSTANT_DWELL_MS;
  const base = DWELL_MS[type] ?? DEFAULT_DWELL_MS;
  return Math.max(80, Math.round(base / speed));
}

export function canEnterPresentation(
  run: ReplayRun | null | undefined,
  binding: PresentationBinding,
): PresentationGate {
  if (!run) return { ok: false, reason: "no_run" };
  if (!TERMINAL_RUN.has(run.status)) return { ok: false, reason: "running" };
  if (!binding.canPresent) return { ok: false, reason: "unaligned" };
  return { ok: true };
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function eventText(event: ReplayEvent): string {
  const payload = event.payload;
  const fromPayload = payload && typeof payload.text === "string" ? payload.text : "";
  return normalizeText(fromPayload || event.title || event.summary || event.payloadPreviewText);
}

function isChatUser(message: PresentationMessage): boolean {
  return message.role === "user" && Boolean(normalizeText(message.content));
}

function isChatAssistant(message: PresentationMessage): boolean {
  return message.role === "assistant" && !message.systemNotice;
}

export function bindMessagesToRun(
  messages: readonly PresentationMessage[],
  events: readonly ReplayEvent[],
): PresentationBinding {
  const revealSeq = new Map<string, number>();
  const startedSeq = new Map<string, number>();
  const completeSeq = new Map<string, number>();
  const prefixIds = new Set<string>();
  const afterIds = new Set<string>();
  const unmatchedInRunIds = new Set<string>();

  const userEvents = events.filter((item) => item.type === "user_message");
  const userMessages = messages.filter(isChatUser);
  const boundUsers = new Map<string, number>();

  const usedUsers = new Set<string>();
  for (const item of userEvents) {
    const text = eventText(item);
    const matched = text
      ? userMessages.find((message) => (
        !usedUsers.has(message.id) && normalizeText(message.content) === text
      ))
      : undefined;
    if (matched) {
      usedUsers.add(matched.id);
      boundUsers.set(matched.id, item.seq);
      revealSeq.set(matched.id, item.seq);
    }
  }
  const leftoverEvents = userEvents.filter((item) => (
    ![...boundUsers.values()].includes(item.seq)
  ));
  const leftoverUsers = userMessages.filter((message) => !usedUsers.has(message.id));
  const pairCount = Math.min(leftoverEvents.length, leftoverUsers.length);
  const userOffset = leftoverUsers.length - pairCount;
  for (let index = 0; index < pairCount; index += 1) {
    const message = leftoverUsers[userOffset + index];
    const item = leftoverEvents[index];
    if (!message || !item) continue;
    boundUsers.set(message.id, item.seq);
    revealSeq.set(message.id, item.seq);
  }

  const firstBoundIndex = messages.findIndex((message) => boundUsers.has(message.id));
  const nextUnboundUserIndex = firstBoundIndex >= 0
    ? messages.findIndex((message, index) => (
      index > firstBoundIndex && isChatUser(message) && !boundUsers.has(message.id)
    ))
    : -1;
  const runEnd = nextUnboundUserIndex >= 0 ? nextUnboundUserIndex : messages.length;

  if (firstBoundIndex < 0) {
    return {
      revealSeq,
      startedSeq,
      completeSeq,
      prefixIds,
      afterIds,
      unmatchedInRunIds,
      canPresent: false,
    };
  }

  for (let index = 0; index < firstBoundIndex; index += 1) {
    prefixIds.add(messages[index]!.id);
  }
  for (let index = runEnd; index < messages.length; index += 1) {
    afterIds.add(messages[index]!.id);
  }

  const inRun = messages.slice(firstBoundIndex, runEnd);
  const toolEvents = events.filter((item) => item.toolCallId && (
    item.type === "tool_call" || item.type === "tool_result"
  ));
  for (const message of inRun) {
    if (message.role !== "tool" || !message.toolCallId) continue;
    const started = toolEvents.find((item) => (
      item.toolCallId === message.toolCallId && item.type === "tool_call"
    ));
    const finished = toolEvents.find((item) => (
      item.toolCallId === message.toolCallId && item.type === "tool_result"
    ));
    if (started) {
      revealSeq.set(message.id, started.seq);
      startedSeq.set(message.id, started.seq);
    }
    if (finished) completeSeq.set(message.id, finished.seq);
  }

  const assistantMessages = inRun.filter(isChatAssistant);
  const completed = events.filter((item) => item.type === "assistant_output_completed");
  const started = events.filter((item) => item.type === "assistant_output_started");
  const assistantCount = Math.min(
    assistantMessages.length,
    Math.max(completed.length, started.length),
  );
  for (let index = 0; index < assistantCount; index += 1) {
    const message = assistantMessages[index];
    if (!message) continue;
    const startEvent = started[index];
    const endEvent = completed[index] ?? started[index];
    if (startEvent) {
      revealSeq.set(message.id, startEvent.seq);
      startedSeq.set(message.id, startEvent.seq);
    } else if (endEvent) {
      revealSeq.set(message.id, endEvent.seq);
    }
    if (endEvent) completeSeq.set(message.id, endEvent.seq);
  }

  for (const message of inRun) {
    if (prefixIds.has(message.id) || afterIds.has(message.id)) continue;
    if (!revealSeq.has(message.id)) unmatchedInRunIds.add(message.id);
  }

  const canPresent = [...revealSeq.keys()].some((id) => {
    const message = messages.find((item) => item.id === id);
    return message ? isChatUser(message) || isChatAssistant(message) : false;
  });

  return {
    revealSeq,
    startedSeq,
    completeSeq,
    prefixIds,
    afterIds,
    unmatchedInRunIds,
    canPresent,
  };
}

export function projectPresentedMessage<T extends PresentationMessage>(
  message: T,
  binding: PresentationBinding,
  cursorSeq: number,
): T {
  const started = binding.startedSeq.get(message.id);
  const completed = binding.completeSeq.get(message.id);
  if (message.role === "tool" && completed !== undefined && cursorSeq < completed) {
    return { ...message, toolStatus: "running" };
  }
  if (
    isChatAssistant(message)
    && started !== undefined
    && completed !== undefined
    && cursorSeq < completed
  ) {
    return { ...message, content: "", blocks: undefined };
  }
  return message;
}

export function sliceMessagesForPresentation<T extends PresentationMessage>(
  messages: readonly T[],
  binding: PresentationBinding,
  cursorSeq: number,
  runLastSeq: number,
): T[] {
  return messages.flatMap((message) => {
    if (binding.prefixIds.has(message.id)) return [message];
    if (binding.afterIds.has(message.id)) return [];
    if (binding.unmatchedInRunIds.has(message.id)) {
      return cursorSeq >= runLastSeq ? [message] : [];
    }
    const reveal = binding.revealSeq.get(message.id);
    if (reveal === undefined || reveal > cursorSeq) return [];
    return [projectPresentedMessage(message, binding, cursorSeq)];
  });
}

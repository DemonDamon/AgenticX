import { create } from "zustand";
import { ulid as newUlid } from "ulid";
import {
  buildAutoTitleFromFirstUserMessage,
  sessionTitleNeedsAutoFill,
  toComplianceMessage,
  type ChatMessage,
  type ChatMessageAttachment,
  type ChatSession,
} from "@agenticx/core-api";
import {
  normalizeTransportErrorMessage,
  type ChatClient,
  type ChatRequest as SdkChatRequest,
  type DeepResearchEvent,
} from "@agenticx/sdk-ts";
import { ChatHistoryHttpError, createPortalChatHistoryClient, HISTORY_PAGE_SIZE } from "./history-client";
import {
  computePayloadHash,
  enqueueAppend,
  flushHistoryOutbox,
  hasPendingAppendOps,
  listPendingOverlayMessages,
  markSessionsDeleted,
  retryDeadLetter,
  stripToAppendPayload,
  type HistoryPrincipal,
  type HistorySyncSessionState,
} from "./history-outbox";
import type { QueuedMessage } from "./types/queued-message";
import { shouldEnqueueOnResend } from "./utils/message-queue";
import { getSessionRequestId, isSessionStreaming } from "./utils/session-stream-state";
import { parseAssistantContent, prepareAssistantContinuation, STREAM_EMPTY_RESPONSE_ERROR } from "./assistant-content";
import { createResponseCheckpoint } from "./utils/response-checkpoint";
import { createStreamTextBuffer } from "./utils/stream-text-buffer";
import { findContinuableResponse } from "./utils/turn-continuation";
import { probeNote } from "./debug/update-depth-probe";
import {
  fetchLatestDeepResearchForHydrate,
  hydrateMessagesDeepResearch,
  normalizeLegacyHydratedMessageIds,
} from "./utils/deep-research-hydrate";
import { startDeepResearchReconnect } from "./utils/deep-research-reconnect";
import { getDeepResearchInteractionPref } from "./utils/deep-research-interaction-pref";
import { fetchActiveDeepResearchRuns } from "./utils/deep-research-active-run";
import {
  buildPlanChatRevisionAssistantMessage,
  fetchPlanChatRunDetail,
  findActivePlanChatGate,
  freezePlanChatSourceDeepResearch,
  latestResearchPlanFromEvents,
  postPlanChatComposerReply,
  resolveDeepResearchEventTargetAssistantId,
  sessionHasPlanChatVersion,
} from "./utils/deep-research-plan-chat-composer";

const UPDATE_DEPTH_ERROR_RE = /Maximum update depth exceeded/i;

/** Remember last open chat so refresh restores the deep-research session, not only newest-by-created. */
const LAST_ACTIVE_SESSION_KEY = "agx-portal-last-active-session-v1";

function readLastActiveSessionId(): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const id = sessionStorage.getItem(LAST_ACTIVE_SESSION_KEY)?.trim();
    return id || null;
  } catch {
    return null;
  }
}

function writeLastActiveSessionId(sessionId: string | null | undefined): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    const id = String(sessionId ?? "").trim();
    if (!id) {
      sessionStorage.removeItem(LAST_ACTIVE_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(LAST_ACTIVE_SESSION_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

/** Throttle mid-run history checkpoints per assistant message. */
const deepResearchCheckpointAtByAssistantId = new Map<string, number>();
const DEEP_RESEARCH_CHECKPOINT_MS = 8_000;
const cancellingSessions = new Set<string>();
/** Prevent concurrent first turns from promoting the same draft more than once. */
const draftSubmissionInFlight = new Set<string>();
const responseCheckpoints = new Map<string, ReturnType<typeof createResponseCheckpoint<ChatMessage>>>();
const streamTextBySession = new Map<string, ReturnType<typeof createStreamTextBuffer>>();

/** Stable code mapped to i18n in web-portal; keep messages intact on catch. */
export const STREAM_UPDATE_DEPTH_ERROR = "STREAM_UPDATE_DEPTH";

/**
 * A provider finish_reason of length is a truncated answer, not a successful
 * completion. The portal translates this exact copy.
 */
export const STREAM_LENGTH_ERROR =
  "回复因达到模型输出上限而提前结束，已保留已生成内容。可点击输入框旁的“继续生成”接着完成。";

export const STREAM_TRANSPORT_ERROR =
  "连接中断，已保留已生成内容。可点击输入框旁的“继续生成”接着完成。";

export const STREAM_INTERRUPTED_ERROR =
  "回复已中断，已保留已生成内容。可继续生成或重试。";

export { STREAM_EMPTY_RESPONSE_ERROR } from "./assistant-content";

const STREAM_LENGTH_FINISH_REASONS = new Set([
  "length",
  "max_tokens",
  "max_output_tokens",
  "token_limit",
  "token_limit_exceeded",
]);

function streamFinishReasonErrorMessage(finishReason: string | null | undefined): string | null {
  const normalized = finishReason?.trim().toLowerCase();
  return normalized && STREAM_LENGTH_FINISH_REASONS.has(normalized) ? STREAM_LENGTH_ERROR : null;
}

function readFinishReason(chunk: object): string | undefined {
  if (!("finishReason" in chunk)) return undefined;
  const value = (chunk as { finishReason?: unknown }).finishReason;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasEmptyOrdinaryResponse(message: ChatMessage | undefined): boolean {
  return Boolean(
    message &&
      !message.deep_research &&
      !parseAssistantContent(message, true).displayContent.trim(),
  );
}

function streamErrorNotice(
  error: { code?: string; message?: string; origin?: string },
  traceId?: string,
): { notice: string; reason: "failed" | "disconnected" } {
  if (error.origin === "transport") {
    return { notice: STREAM_TRANSPORT_ERROR, reason: "disconnected" };
  }
  const notice = toComplianceMessage(error.code, error.message?.trim() || STREAM_INTERRUPTED_ERROR, traceId);
  return { notice, reason: "failed" };
}

function toStreamCatchErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown send error";
  if (UPDATE_DEPTH_ERROR_RE.test(raw)) {
    return STREAM_UPDATE_DEPTH_ERROR;
  }
  return raw;
}

export type ChatStatus = "idle" | "sending" | "streaming" | "error";

export type SessionStreamState = {
  status: "sending" | "streaming";
  activeRequestId: string;
  assistantMessageId?: string;
};

type SendMessageInput = {
  content: string;
  attachments?: import("@agenticx/core-api").ChatMessageAttachment[];
  tenantId?: string;
  userId?: string;
  webSearch?: boolean;
  deepResearch?: boolean;
  skillId?: string;
};

type SendMessageOptions = {
  /** Interrupt current stream and send immediately (queue send-now / double Enter). */
  forceSend?: boolean;
  /** Dispatch to this session even when another conversation is currently active. */
  targetSessionId?: string;
  /** Fires once accepted, carrying the actual session id after draft promotion. */
  onAccepted?: (sessionId: string) => void;
};

function notifyMessageAccepted(
  onAccepted: SendMessageOptions["onAccepted"],
  sessionId: string,
): void {
  try {
    onAccepted?.(sessionId);
  } catch {
    // Composer bookkeeping must not stop a turn that the store already accepted.
  }
}

type EditUserMessageInput = {
  messageId: string;
  content: string;
  tenantId?: string;
  userId?: string;
};

export type SessionTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastUpdatedAt: string | null;
};

export type AssistantResponseVersion = {
  id: string;
  content: string;
  created_at: string;
  model?: string;
  queryVersionIndex: number;
  retryAttempt: number;
  queryText: string;
  web_search_sources?: ChatMessage["web_search_sources"];
  deep_research?: ChatMessage["deep_research"];
  interruption?: ChatMessage["interruption"];
};

export type UserResponseVersionState = {
  versions: AssistantResponseVersion[];
  activeIndex: number;
  activeAssistantIndexByQueryVersion: Record<number, number>;
};

export type ChatStoreState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  activeModel: string;
  activeRequestId: string | null;
  errorMessage: string | null;
  sessionTokens: SessionTokenUsage;
  /** 按会话累计 token，切换会话时与 sessionTokens 同步 */
  sessionTokensBySessionId: Record<string, SessionTokenUsage>;
  responseVersionsByUserMessageId: Record<string, UserResponseVersionState>;
  /** 服务端历史已加载（Enterprise portal） */
  hydrated: boolean;
  historyLoading: boolean;
  /** Session metadata arrived; writes may persist before message restore finishes. */
  historyListLoaded: boolean;
  historyNextCursor: string | null;
  historyLoadingMore: boolean;
  historyLoadMoreError: string | null;
  historyError: string | null;
  /** Per-session durable history sync status (separate from rename/delete historyError). */
  historySyncBySessionId: Record<string, HistorySyncSessionState>;
  historyPrincipal: HistoryPrincipal | null;
  sessionMessagesLoading: boolean;
  /** 本地草稿 session：用户发送首条消息前不落盘（对齐 Machi Desktop lazy create） */
  draftSessionId: string | null;
  /** 流式生成中排队等待发送的消息（按 session 隔离） */
  pendingMessages: QueuedMessage[];
  /** 当前正在 sending/streaming 的会话，供侧栏状态指示（切换会话后仍指向原 session） */
  streamingSessionId: string | null;
  /** 按 session 隔离的流式状态，支持多 session 并发 */
  streamStateBySessionId: Record<string, SessionStreamState>;
  /** Last composer web-search toggle per session (retry / regenerate / queue). */
  lastWebSearchBySessionId: Record<string, boolean>;
  /** Last composer deep-research toggle per session (retry / regenerate / queue). */
  lastDeepResearchBySessionId: Record<string, boolean>;
  /** Enterprise skill id bound to a session until cleared. */
  lastSkillIdBySessionId: Record<string, string>;
  /** 主输入正在改计划（resume HTTP 进行中）——输入区显示发送中，而非假 idle。 */
  planChatRevising: boolean;
};

const EMPTY_USAGE: SessionTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  lastInputTokens: 0,
  lastOutputTokens: 0,
  lastUpdatedAt: null,
};

export type ChatStoreActions = {
  hydrateSessions(): Promise<void>;
  loadMoreSessions(): Promise<void>;
  bootstrap(params?: { tenantId?: string; userId?: string; defaultModel?: string; title?: string }): void;
  createSession(params?: { tenantId?: string; userId?: string; defaultModel?: string; title?: string }): Promise<void>;
  switchSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  pinSession(sessionId: string, pinned: boolean): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessions(sessionIds: string[]): Promise<void>;
  switchModel(model: string): void;
  sendMessage(client: ChatClient, input: SendMessageInput, options?: SendMessageOptions): Promise<void>;
  /**
   * 计划对齐 gate：用主输入内容改计划（resume），不新开一轮对话。
   * @returns true 已处理；false 当前无 plan_chat gate。
   */
  resumePlanChatFromComposer(content: string): Promise<boolean>;
  sendQueuedMessageNow(client: ChatClient, messageId: string): Promise<void>;
  removePendingMessage(messageId: string): void;
  editPendingMessage(messageId: string, content: string): void;
  editUserMessageAndResend(client: ChatClient, input: EditUserMessageInput): Promise<void>;
  regenerateAssistantResponse(
    client: ChatClient,
    assistantMessageId: string,
    mode?: { continue?: boolean },
  ): Promise<void>;
  continueResponse(client: ChatClient, assistantMessageId: string): Promise<void>;
  /** Open a continuation run for a stopped report and attach it to this session. */
  attachReportContinuation(sessionId: string, runId: string): Promise<void>;
  showPreviousResponseVersion(userMessageId: string): void;
  showNextResponseVersion(userMessageId: string): void;
  showPreviousRetryVersion(userMessageId: string): void;
  showNextRetryVersion(userMessageId: string): void;
  cancel(client: ChatClient): Promise<void>;
  deleteMessage(messageId: string): void;
  setDeepResearchClarifyAnswers(assistantMessageId: string, answers: Record<string, string>): void;
  setHistoryPrincipal(principal: HistoryPrincipal | null): void;
  setHistorySyncBySessionId(bySessionId: Record<string, HistorySyncSessionState>): void;
  retryHistorySync(sessionId: string): Promise<void>;
  refetchSessionMessages(sessionId: string): Promise<void>;
};

export type ChatStore = ChatStoreState & ChatStoreActions;

const DEFAULT_MODEL = "mock-model-v1";
const DEFAULT_TENANT = "tenant-local";
const DEFAULT_USER = "user-local";

function makeId(): string {
  return newUlid();
}

function now(): string {
  return new Date().toISOString();
}

/** Stamp a user/assistant pair so PG ORDER BY created_at keeps user first. */
function pairedCreatedAt(baseMs: number = Date.now()): { user: string; assistant: string } {
  return {
    user: new Date(baseMs).toISOString(),
    assistant: new Date(baseMs + 1).toISOString(),
  };
}

function addChunkToSessionTokens(
  prev: SessionTokenUsage,
  chunk: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): SessionTokenUsage {
  return {
    inputTokens: prev.inputTokens + (chunk.inputTokens ?? 0),
    outputTokens: prev.outputTokens + (chunk.outputTokens ?? 0),
    totalTokens: prev.totalTokens + (chunk.totalTokens ?? 0),
    lastInputTokens: chunk.inputTokens ?? 0,
    lastOutputTokens: chunk.outputTokens ?? 0,
    lastUpdatedAt: now(),
  };
}

type ChatStoreSet = (
  partial: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>),
) => void;

function topLevelStreamFieldsForSession(
  state: Pick<ChatStoreState, "streamStateBySessionId">,
  sessionId: string | null,
): Pick<ChatStoreState, "status" | "activeRequestId"> {
  if (!sessionId) return { status: "idle", activeRequestId: null };
  const stream = state.streamStateBySessionId[sessionId];
  if (!stream) return { status: "idle", activeRequestId: null };
  return { status: stream.status, activeRequestId: stream.activeRequestId };
}

function setSessionStream(set: ChatStoreSet, sessionId: string, next: SessionStreamState | null): void {
  set((prev) => {
    const map = { ...prev.streamStateBySessionId };
    if (next) {
      map[sessionId] = next;
    } else {
      delete map[sessionId];
    }
    const isActive = prev.activeSessionId === sessionId;
    return {
      streamStateBySessionId: map,
      ...(isActive
        ? {
            status: next?.status ?? ("idle" as const),
            activeRequestId: next?.activeRequestId ?? null,
          }
        : {}),
      streamingSessionId: next ? sessionId : prev.streamingSessionId === sessionId ? null : prev.streamingSessionId,
    };
  });
}

function buildUserContentWithDocuments(
  content: string,
  attachments: ChatMessageAttachment[] | undefined,
): string {
  const docs = (attachments ?? []).filter((item) => item.parsed_text?.trim());
  if (docs.length === 0) return content;
  const blocks = docs
    .map((item) => `--- 附件: ${item.name} ---\n${item.parsed_text!.trim()}`)
    .join("\n\n");
  const trimmed = content.trim();
  return trimmed ? `${trimmed}\n\n${blocks}` : blocks;
}

/**
 * Send answer text as history, excluding reasoning and appended transport/error
 * notices. Saved messages retain both for display and continuation.
 * Empty assistant placeholders are still omitted (providers reject them).
 */
export function filterMessagesForCompletion(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (message.control === "continue_report") return [];
    if (message.role !== "assistant") return [message];
    const prefix = message.interruption
      ? message.content.slice(0, message.interruption.contentLength)
      : message.content;
    const content = prepareAssistantContinuation(prefix).requestContent;
    if (!content.trim()) return [];
    return [content === message.content ? message : { ...message, content }];
  });
}

function toSdkRequest(
  sessionId: string,
  model: string,
  messages: ChatMessage[],
  webSearch?: boolean,
  deepResearch?: boolean,
  interactionPref: string = "auto",
  skillId?: string,
): SdkChatRequest {
  return {
    sessionId,
    model,
    stream: true,
    messages: filterMessagesForCompletion(messages).map((message) => {
      const content =
        message.role === "user"
          ? buildUserContentWithDocuments(message.content, message.attachments)
          : message.content;
      const imageAttachments = message.attachments?.filter(
        (item) => item.mime_type.startsWith("image/") && item.data_url?.trim(),
      );
      return {
        id: message.id,
        role: message.role === "tool" ? "assistant" : message.role,
        content,
        attachments: imageAttachments?.map((item) => ({
          name: item.name,
          mimeType: item.mime_type,
          size: item.size,
          dataUrl: item.data_url,
          kind: item.kind,
          parsedText: item.parsed_text,
        })),
        createdAt: message.created_at,
      };
    }),
    ...(webSearch ? { webSearch: true } : {}),
    ...(skillId ? { skillId } : {}),
    ...(deepResearch ? { deepResearch: true } : {}),
    ...(deepResearch && interactionPref !== "auto"
      ? { deepResearchInteraction: interactionPref }
      : {}),
  };
}

function findUserAndAssistantIndex(messages: ChatMessage[], userMessageId: string): { userIndex: number; assistantIndex: number } {
  const userIndex = messages.findIndex((message) => message.id === userMessageId && message.role === "user");
  if (userIndex < 0) return { userIndex: -1, assistantIndex: -1 };

  let assistantIndex = -1;
  for (let i = userIndex + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") break;
    if (messages[i]?.role === "assistant") {
      assistantIndex = i;
      break;
    }
  }
  return { userIndex, assistantIndex };
}

function findAssistantAndRelatedUserIndex(
  messages: ChatMessage[],
  assistantMessageId: string,
): { assistantIndex: number; userIndex: number } {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId && message.role === "assistant");
  if (assistantIndex < 0) return { assistantIndex: -1, userIndex: -1 };

  let userIndex = -1;
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      userIndex = i;
      break;
    }
  }
  return { assistantIndex, userIndex };
}

function toAssistantVersion(
  message: ChatMessage,
  meta?: { queryVersionIndex?: number; retryAttempt?: number; queryText?: string },
): AssistantResponseVersion {
  return {
    id: message.id,
    content: message.content,
    created_at: message.created_at,
    model: message.model,
    queryVersionIndex: meta?.queryVersionIndex ?? 0,
    retryAttempt: meta?.retryAttempt ?? 0,
    queryText: meta?.queryText ?? "",
    web_search_sources: message.web_search_sources,
    deep_research: message.deep_research,
    interruption: message.interruption,
  };
}

function applyDeepResearchEventToAssistant(
  set: ChatStoreSet,
  assistantId: string,
  userMessageId: string | undefined,
  event: DeepResearchEvent,
) {
  // 计划对齐：updated 方案拆成对话流里的新助手气泡，避免同一张卡原地改版本。
  if (event.type === "research_plan" && event.action === "updated") {
    let forkedPlanChat = false;
    set((prev) => {
      const source = prev.messages.find((m) => m.id === assistantId);
      if (!source?.deep_research) return prev;
      const visibility =
        source.deep_research.profile?.planVisibility ??
        [...(source.deep_research.events ?? [])]
          .reverse()
          .find((e) => e.type === "research_profile")?.planVisibility;
      if (visibility !== "chat_editable") return prev;
      forkedPlanChat = true;
      const sessionId = source.session_id;
      if (
        sessionHasPlanChatVersion(prev.messages, sessionId, event.runId, event.version)
      ) {
        const keepMax = Math.max(1, event.version - 1);
        return {
          messages: prev.messages.map((message) => {
            if (message.id !== assistantId || !message.deep_research) return message;
            return {
              ...message,
              deep_research: freezePlanChatSourceDeepResearch(
                message.deep_research,
                keepMax,
              ),
            };
          }),
        };
      }
      const keepMax =
        source.deep_research.planVersion ??
        source.deep_research.plan?.version ??
        Math.max(1, event.version - 1);
      const revision = buildPlanChatRevisionAssistantMessage({
        id: makeId(),
        sessionId,
        tenantId: source.tenant_id,
        userId: source.user_id,
        runId: event.runId,
        plan: event.plan,
        version: event.version,
        profile: source.deep_research.profile,
      });
      return {
        messages: [
          ...prev.messages.map((message) => {
            if (message.id !== assistantId || !message.deep_research) return message;
            return {
              ...message,
              deep_research: freezePlanChatSourceDeepResearch(
                message.deep_research,
                keepMax,
              ),
            };
          }),
          revision,
        ],
        sessions: prev.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                message_count: session.message_count + 1,
                last_message_at: now(),
                updated_at: now(),
              }
            : session,
        ),
      };
    });
    if (forkedPlanChat) return;
  }

  set((prev) => {
    const targetId = resolveDeepResearchEventTargetAssistantId(
      prev.messages,
      assistantId,
      event,
    );
    const patchMessage = (message: ChatMessage): ChatMessage => {
      if (message.id !== targetId) return message;
      const prevDr = message.deep_research;
      const runId =
        ("runId" in event && typeof event.runId === "string" && event.runId) ||
        prevDr?.runId ||
        "unknown";
      let status: NonNullable<ChatMessage["deep_research"]>["status"] = prevDr?.status ?? "running";
      if (event.type === "clarify" || event.type === "clarify_chat") {
        status = "awaiting_clarify";
      } else if (event.type === "research_plan" && event.action === "proposed") {
        // 计划对齐 / 先看计划：草案提出后阻塞等待用户确认/修改。
        status = "awaiting_clarify";
      } else if (event.type === "research_plan" && event.action === "approved") {
        status = "running";
      } else if (event.type === "research_plan" && event.action === "updated") {
        // chat_editable：更新后仍在多轮对话 gate；legacy editable 编辑后立刻开跑。
        status =
          prevDr?.profile?.planVisibility === "chat_editable"
            ? "awaiting_clarify"
            : "running";
      } else if (event.type === "phase" && event.phase === "done") {
        const eventsSoFar = [...(prevDr?.events ?? []), event];
        status = eventsSoFar.some((item) => item.type === "report_resume_available")
          ? "failed"
          : "completed";
      } else if (
        status === "awaiting_clarify" &&
        (event.type === "clarify_timeout" ||
          event.type === "lane_started" ||
          event.type === "phase" ||
          event.type === "run_started" ||
          event.type === "narrative")
      ) {
        // Post-resume / timeout 离开澄清 gate。
        // 计划对齐 gate 未结束时，phase/narrative/run_started 不得把 status 打成 running，
        // 否则主输入会误判为「流式中」而排队。
        // recon-cold-start 的 lane_started 出现在 plan 之前/并行，不得结束 gate。
        const laneId =
          event.type === "lane_started" && typeof event.laneId === "string"
            ? event.laneId
            : "";
        const isReconLane =
          event.type === "lane_started" &&
          (laneId === "recon-cold-start" || laneId.startsWith("recon-"));
        if (isReconLane) {
          status = "awaiting_clarify";
        } else {
          const eventsSoFar = [...(prevDr?.events ?? []), event];
          const latestPlan = [...eventsSoFar]
            .reverse()
            .find((e) => e.type === "research_plan");
          const profileVisibility =
            prevDr?.profile?.planVisibility ??
            [...(prevDr?.events ?? [])]
              .reverse()
              .find((e) => e.type === "research_profile")?.planVisibility;
          const chatEditable = profileVisibility === "chat_editable";
          const planGateOpen =
            latestPlan?.type === "research_plan" &&
            (latestPlan.action === "proposed" ||
              (chatEditable && latestPlan.action === "updated"));
          if (planGateOpen && event.type !== "lane_started" && event.type !== "clarify_timeout") {
            status = "awaiting_clarify";
          } else {
            status = "running";
          }
        }
      }
      const events = [...(prevDr?.events ?? []), event].slice(-200);
      const artifactIds = [...(prevDr?.artifactIds ?? [])];
      if (event.type === "artifact" && !artifactIds.includes(event.id)) {
        artifactIds.push(event.id);
      }
      // research_profile / research_plan 快照：从事件流派生最新状态，供工作台与重连恢复。
      let profile = prevDr?.profile;
      let plan = prevDr?.plan;
      let planVersion = prevDr?.planVersion;
      if (event.type === "research_profile") {
        profile = {
          researchDepth: event.researchDepth,
          clarifyMode: event.clarifyMode,
          clarifyBudget: event.clarifyBudget,
          planVisibility: event.planVisibility,
          assumptions: event.assumptions,
        };
      } else if (event.type === "research_plan") {
        plan = event.plan;
        planVersion = event.version;
      }
      return {
        ...message,
        deep_research: {
          runId,
          status,
          events,
          artifactIds,
          clarifyAnswers: prevDr?.clarifyAnswers,
          ...(profile ? { profile } : {}),
          ...(plan ? { plan } : {}),
          ...(planVersion ? { planVersion } : {}),
          ...(profile?.assumptions?.length ? { assumptions: profile.assumptions } : {}),
        },
      };
    };

    const nextMessages = prev.messages.map(patchMessage);
    if (!userMessageId) return { messages: nextMessages };
    const current = prev.responseVersionsByUserMessageId[userMessageId];
    if (!current) return { messages: nextMessages };
    return {
      messages: nextMessages,
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [userMessageId]: {
          ...current,
          versions: current.versions.map((version, index) =>
            index === current.activeIndex
              ? {
                  ...version,
                  deep_research: nextMessages.find((m) => m.id === targetId)?.deep_research,
                }
              : version,
          ),
        },
      },
    };
  });
}

function applyWebSearchSourcesToAssistant(
  set: ChatStoreSet,
  assistantId: string,
  userMessageId: string | undefined,
  sources: NonNullable<ChatMessage["web_search_sources"]>,
) {
  set((prev) => {
    const nextMessages = prev.messages.map((message) =>
      message.id === assistantId ? { ...message, web_search_sources: sources } : message,
    );
    if (!userMessageId) {
      return { messages: nextMessages };
    }
    const current = prev.responseVersionsByUserMessageId[userMessageId];
    if (!current) {
      return { messages: nextMessages };
    }
    return {
      messages: nextMessages,
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [userMessageId]: {
          ...current,
          versions: current.versions.map((version, index) =>
            index === current.activeIndex ? { ...version, web_search_sources: sources } : version,
          ),
        },
      },
    };
  });
}

function findVersionIndexByAssistantId(versions: AssistantResponseVersion[], assistantId: string): number {
  return versions.findIndex((version) => version.id === assistantId);
}

function getSortedQueryVersionIndices(versions: AssistantResponseVersion[]): number[] {
  return Array.from(new Set(versions.map((version) => version.queryVersionIndex))).sort((a, b) => a - b);
}

function getIndicesForQueryVersion(versions: AssistantResponseVersion[], queryVersionIndex: number): number[] {
  return versions
    .map((version, index) => ({ version, index }))
    .filter(({ version }) => version.queryVersionIndex === queryVersionIndex)
    .sort((a, b) => (a.version.retryAttempt - b.version.retryAttempt) || (a.index - b.index))
    .map(({ index }) => index);
}

function getSessionMessages(messages: ChatMessage[], sessionId: string): ChatMessage[] {
  return messages.filter((message) => message.session_id === sessionId);
}

function mergeSessionMessages(messages: ChatMessage[], sessionId: string, sessionMessages: ChatMessage[]): ChatMessage[] {
  const rest = messages.filter((message) => message.session_id !== sessionId);
  return [...rest, ...sessionMessages];
}

let chatHydrateInFlight: Promise<void> | null = null;
let historyPageLoadInFlight: Promise<void> | null = null;
let sessionMessageLoadSeq = 0;
let historyAuthRedirectScheduled = false;
const historyAppendChainsBySessionId = new Map<string, Promise<void>>();
const portalHistory = createPortalChatHistoryClient();

function mergeOverlayMessages(remote: ChatMessage[], overlay: ChatMessage[]): ChatMessage[] {
  remote = normalizeLegacyHydratedMessageIds(remote);
  overlay = normalizeLegacyHydratedMessageIds(overlay);
  if (overlay.length === 0) return remote;
  const byId = new Map<string, ChatMessage>();
  for (const message of remote) byId.set(message.id, message);
  for (const message of overlay) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => {
    const at = Date.parse(a.created_at) || 0;
    const bt = Date.parse(b.created_at) || 0;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

function setSessionHistorySync(
  set: (partial: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void,
  sessionId: string,
  sync: HistorySyncSessionState | null,
): void {
  set((prev) => {
    const next = { ...prev.historySyncBySessionId };
    if (!sync || sync.state === "idle") {
      delete next[sessionId];
    } else {
      next[sessionId] = sync;
    }
    return { historySyncBySessionId: next };
  });
}

async function persistAppendMessages(
  set: (partial: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  const prior = historyAppendChainsBySessionId.get(sessionId) ?? Promise.resolve();
  const current = prior
    .catch(() => undefined)
    .then(() => persistAppendMessagesNow(set, sessionId, messages));
  historyAppendChainsBySessionId.set(sessionId, current);
  try {
    await current;
  } finally {
    if (historyAppendChainsBySessionId.get(sessionId) === current) {
      historyAppendChainsBySessionId.delete(sessionId);
    }
  }
}

async function persistAppendMessagesNow(
  set: (partial: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  messages = messages.filter((message) => message.control !== "continue_report");
  if (messages.length === 0) return;
  const payloads = messages.map(stripToAppendPayload);
  const operationId = newUlid();
  const payloadHash = await computePayloadHash(payloads);
  const queuedFirst = await hasPendingAppendOps(sessionId);
  if (queuedFirst) {
    const result = await enqueueAppend(sessionId, messages, { operationId, payloadHash });
    if (!result.enqueued) {
      setSessionHistorySync(set, sessionId, {
        pendingCount: 1,
        state: "dead_letter",
        message: result.reason || "这段对话尚未同步到服务器",
      });
      return;
    }
    void flushHistoryOutbox();
    return;
  }

  try {
    await portalHistory.appendMessages(sessionId, payloads, {
      operationId,
      payloadHash,
      retries: 5,
    });
    setSessionHistorySync(set, sessionId, null);
    // Same global-banner-stickiness fix as switchSession/refetchSessionMessages.
    set({ historyError: null });
  } catch (persistErr) {
    const result = await enqueueAppend(sessionId, messages, { operationId, payloadHash });
    if (!result.enqueued) {
      setSessionHistorySync(set, sessionId, {
        pendingCount: 1,
        state: "dead_letter",
        message:
          result.reason ||
          resolveHistoryErrorMessage(persistErr, "这段对话尚未同步到服务器，将自动重试"),
      });
      return;
    }
    void flushHistoryOutbox();
  }
}

function appendStreamFinishReasonNotice(content: string, notice: string): string {
  if (content.includes(notice)) return content;
  // Checkpoints/Continue use an exact byte prefix, including trailing whitespace.
  return content ? `${content}\n\n${notice}` : notice;
}

function appendStreamErrorText(content: string, errorMessage: string): string {
  if (content.includes(errorMessage)) return content;
  // A provider can stop before closing its reasoning block. Keep the
  // failure notice outside that block so the user can actually see it.
  const retained = prepareAssistantContinuation(content).retainedContent;
  return retained ? `${retained}\n\n${errorMessage}` : errorMessage;
}

function appendStreamFinishReasonNoticeToAssistant(
  set: ChatStoreSet,
  assistantId: string,
  userMessageId: string | undefined,
  notice: string,
): void {
  set((prev) => {
    const nextMessages = prev.messages.map((message) => {
      if (message.id !== assistantId || message.role !== "assistant") return message;
      const content = appendStreamFinishReasonNotice(message.content, notice);
      return content === message.content
        ? message
        : {
            ...message,
            content,
            interruption: message.interruption ?? { reason: "failed" as const, contentLength: message.content.length },
          };
    });
    if (!userMessageId) return { messages: nextMessages };
    const current = prev.responseVersionsByUserMessageId[userMessageId];
    if (!current) return { messages: nextMessages };
    return {
      messages: nextMessages,
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [userMessageId]: {
          ...current,
          versions: current.versions.map((version, index) => {
            if (index !== current.activeIndex) return version;
            const content = appendStreamFinishReasonNotice(version.content, notice);
            return content === version.content
              ? version
              : {
                  ...version,
                  content,
                  interruption: version.interruption ?? { reason: "failed" as const, contentLength: version.content.length },
                };
          }),
        },
      },
    };
  });
}

function appendStreamErrorToAssistant(
  set: ChatStoreSet,
  assistantId: string,
  userMessageId: string | undefined,
  errorMessage: string,
  reason: "failed" | "disconnected" = "failed",
): void {
  set((prev) => {
    const nextMessages = prev.messages.map((message) =>
      message.id === assistantId && message.role === "assistant"
        ? {
            ...message,
            interruption: message.interruption ?? { reason, contentLength: message.content.length },
            content: appendStreamErrorText(message.content, errorMessage),
          }
        : message,
    );
    if (!userMessageId) return { messages: nextMessages };
    const current = prev.responseVersionsByUserMessageId[userMessageId];
    if (!current) return { messages: nextMessages };
    return {
      messages: nextMessages,
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [userMessageId]: {
          ...current,
          versions: current.versions.map((version, index) =>
            index === current.activeIndex
              ? {
                  ...version,
                  content: appendStreamErrorText(version.content, errorMessage),
                  interruption: version.interruption ?? { reason, contentLength: version.content.length },
                }
              : version,
          ),
        },
      },
    };
  });
}

function settleOrdinaryTerminal(
  set: ChatStoreSet,
  get: () => ChatStoreState,
  sessionId: string,
  assistantId: string,
  userMessageId: string,
  deepResearchEnabled: boolean,
  streamCancelled: boolean,
  streamFinishReason: string | undefined,
): void {
  const assistantNow = get().messages.find((message) => message.id === assistantId);
  if (assistantNow?.interruption?.reason === "cancelled") return;
  const finishReasonError = streamFinishReasonErrorMessage(streamFinishReason);
  const emptyError =
    !finishReasonError &&
    !streamCancelled &&
    !deepResearchEnabled &&
    get().status !== "error" &&
    hasEmptyOrdinaryResponse(assistantNow)
      ? STREAM_EMPTY_RESPONSE_ERROR
      : null;
  const terminalError = finishReasonError ?? emptyError;
  if (!terminalError) return;
  if (terminalError === STREAM_EMPTY_RESPONSE_ERROR) {
    appendStreamErrorToAssistant(set, assistantId, userMessageId, terminalError, "failed");
  } else {
    appendStreamFinishReasonNoticeToAssistant(set, assistantId, userMessageId, terminalError);
  }
  set((prev) =>
    prev.activeSessionId === sessionId
      ? { status: "error" as const, errorMessage: terminalError }
      : {},
  );
}

function createAssistantStreamWriter(
  set: ChatStoreSet,
  get: () => ChatStoreState,
  sessionId: string,
  assistantId: string,
  userMessageId: string,
  ownsRequest: () => boolean,
) {
  const writer = createStreamTextBuffer((delta) => {
    if (!ownsRequest()) return;
    set((prev) => {
      const current = prev.responseVersionsByUserMessageId[userMessageId];
      return {
        messages: prev.messages.map((message) =>
          message.id === assistantId ? { ...message, content: message.content + delta } : message,
        ),
        responseVersionsByUserMessageId: current
          ? {
              ...prev.responseVersionsByUserMessageId,
              [userMessageId]: {
                ...current,
                versions: current.versions.map((version) =>
                  version.id === assistantId ? { ...version, content: version.content + delta } : version,
                ),
              },
            }
          : prev.responseVersionsByUserMessageId,
      };
    });
  }, get().messages.find((message) => message.id === assistantId)?.content.length);
  streamTextBySession.get(sessionId)?.stop();
  streamTextBySession.set(sessionId, writer);
  return {
    push: writer.push,
    flush: writer.flush,
    stop() {
      try {
        writer.stop();
      } finally {
        if (streamTextBySession.get(sessionId) === writer) streamTextBySession.delete(sessionId);
      }
    },
  };
}

function canPersistHistory(state: ChatStoreState): boolean {
  return state.hydrated || state.historyListLoaded || state.historyPrincipal !== null;
}

function checkpointOrdinaryResponse(
  set: ChatStoreSet,
  get: () => ChatStoreState,
  sessionId: string,
  userMessageId: string,
  assistantId: string,
  ownsRequest: () => boolean,
) {
  const checkpoint = createResponseCheckpoint<ChatMessage>({
    read: () => {
      if (!canPersistHistory(get()) || !ownsRequest()) return undefined;
      const assistant = get().messages.find((message) => message.id === assistantId);
      return assistant?.role === "assistant" && !assistant.deep_research ? assistant : undefined;
    },
    save: async (assistant) => {
      const user = get().messages.find((message) => message.id === userMessageId && message.role === "user");
      const snapshot: ChatMessage = {
        ...assistant,
        // Snapshot-only marker: an interrupted page can offer Continue,
        // but the live answer remains running and the final append clears it.
        interruption: { reason: "disconnected", contentLength: assistant.content.length },
      };
      await persistAppendMessages(set, sessionId, user ? [user, snapshot] : [snapshot]);
    },
    onError: () =>
      setSessionHistorySync(set, sessionId, {
        pendingCount: 1,
        state: "dead_letter",
        message: "中途回复尚未保存，请保留页面并重试同步。",
      }),
  });
  responseCheckpoints.get(assistantId)?.stop();
  responseCheckpoints.set(assistantId, checkpoint);
  return {
    changed: checkpoint.changed,
    stop() {
      checkpoint.stop();
      if (responseCheckpoints.get(assistantId) === checkpoint) responseCheckpoints.delete(assistantId);
    },
  };
}

function resolveHistoryErrorMessage(error: unknown, fallback: string): string {
  const unauthorized =
    (error instanceof ChatHistoryHttpError && error.status === 401) ||
    (error instanceof Error && /unauthorized/i.test(error.message));

  if (unauthorized) {
    if (typeof window !== "undefined" && !historyAuthRedirectScheduled) {
      historyAuthRedirectScheduled = true;
      const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.setTimeout(() => {
        window.location.assign(`/auth?returnTo=${returnTo}`);
      }, 0);
    }
    return "登录已过期，请重新登录";
  }

  const raw = error instanceof Error ? error.message : fallback;
  // Reuse chat transport copy so "Failed to fetch" never surfaces raw in 历史同步.
  return normalizeTransportErrorMessage(raw);
}

function stripVersionsForSession(
  state: ChatStoreState,
  sessionId: string
): Record<string, UserResponseVersionState> {
  const userIds = new Set(
    state.messages.filter((m) => m.session_id === sessionId && m.role === "user").map((m) => m.id)
  );
  const next = { ...state.responseVersionsByUserMessageId };
  for (const id of userIds) {
    delete next[id];
  }
  return next;
}

function isDraftSessionId(state: Pick<ChatStoreState, "draftSessionId">, sessionId: string | null): boolean {
  return !!sessionId && sessionId === state.draftSessionId;
}

function sortSessionsForHistory(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    const aPinned = a.pinned_at ? Date.parse(a.pinned_at) : 0;
    const bPinned = b.pinned_at ? Date.parse(b.pinned_at) : 0;
    if (aPinned !== bPinned) {
      if (aPinned === 0) return 1;
      if (bPinned === 0) return -1;
      return bPinned - aPinned;
    }
    const aCreated = Date.parse(a.created_at) || 0;
    const bCreated = Date.parse(b.created_at) || 0;
    if (aCreated !== bCreated) return bCreated - aCreated;
    return b.id.localeCompare(a.id);
  });
}

function discardDraftSessionPatch(state: ChatStoreState): Partial<ChatStoreState> {
  if (!state.draftSessionId) return {};
  const draftId = state.draftSessionId;
  const nextTokens = { ...state.sessionTokensBySessionId };
  delete nextTokens[draftId];
  return {
    draftSessionId: null,
    messages: state.messages.filter((message) => message.session_id !== draftId),
    sessionTokensBySessionId: nextTokens,
  };
}

function beginDraftSessionPatch(
  state: ChatStoreState,
  params?: { defaultModel?: string },
): Partial<ChatStoreState> {
  const prevDraftId = state.draftSessionId;
  const draftId = makeId();
  const nextTokens = { ...state.sessionTokensBySessionId };
  if (prevDraftId) delete nextTokens[prevDraftId];
  nextTokens[draftId] = { ...EMPTY_USAGE };
  const withoutOldDraftMessages = prevDraftId
    ? state.messages.filter((message) => message.session_id !== prevDraftId)
    : state.messages;
  return {
    draftSessionId: draftId,
    activeSessionId: draftId,
    activeModel: params?.defaultModel ?? state.activeModel ?? DEFAULT_MODEL,
    messages: withoutOldDraftMessages,
    status: "idle",
    errorMessage: null,
    activeRequestId: null,
    historyError: null,
    sessionMessagesLoading: false,
    sessionTokens: { ...EMPTY_USAGE },
    sessionTokensBySessionId: nextTokens,
    responseVersionsByUserMessageId: {},
  };
}

function buildHydratedResponseVersions(messages: ChatMessage[]): Record<string, UserResponseVersionState> {
  const result: Record<string, UserResponseVersionState> = {};
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m?.role === "user") {
      const userMsg = m;
      const assistants: ChatMessage[] = [];
      i += 1;
      while (i < messages.length && messages[i]?.role === "assistant") {
        const a = messages[i];
        if (a) assistants.push(a);
        i += 1;
      }
      if (assistants.length > 0) {
        const versions = assistants.map((a, idx) =>
          toAssistantVersion(a, {
            queryVersionIndex: 0,
            retryAttempt: idx,
            queryText: userMsg.content,
          })
        );
        result[userMsg.id] = {
          versions,
          activeIndex: versions.length - 1,
          activeAssistantIndexByQueryVersion: { 0: versions.length - 1 },
        };
      }
    } else {
      i += 1;
    }
  }
  return result;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  status: "idle",
  activeModel: DEFAULT_MODEL,
  activeRequestId: null,
  errorMessage: null,
  sessionTokens: { ...EMPTY_USAGE },
  sessionTokensBySessionId: {},
  responseVersionsByUserMessageId: {},
  hydrated: false,
  historyLoading: false,
  historyListLoaded: false,
  historyNextCursor: null,
  historyLoadingMore: false,
  historyLoadMoreError: null,
  historyError: null,
  historySyncBySessionId: {},
  historyPrincipal: null,
  sessionMessagesLoading: false,
  draftSessionId: null,
  pendingMessages: [],
  streamingSessionId: null,
  streamStateBySessionId: {},
  lastWebSearchBySessionId: {},
  lastDeepResearchBySessionId: {},
  lastSkillIdBySessionId: {},
  planChatRevising: false,

  setHistoryPrincipal(principal) {
    set({ historyPrincipal: principal });
  },

  setHistorySyncBySessionId(bySessionId) {
    set({ historySyncBySessionId: bySessionId });
  },

  async retryHistorySync(sessionId) {
    await retryDeadLetter(sessionId);
  },

  async refetchSessionMessages(sessionId) {
    if (!get().hydrated || isDraftSessionId(get(), sessionId)) return;
    try {
      const remoteMessages = await portalHistory.getMessages(sessionId);
      const overlay = await listPendingOverlayMessages(sessionId);
      const merged = await hydrateMessagesDeepResearch(
        sessionId,
        mergeOverlayMessages(remoteMessages, overlay),
      );
      set((prev) => {
        const others = prev.messages.filter((message) => message.session_id !== sessionId);
        return {
          messages: [...others, ...merged],
          responseVersionsByUserMessageId: {
            ...stripVersionsForSession(prev, sessionId),
            ...buildHydratedResponseVersions(merged),
          },
          // Same global-banner-stickiness fix as switchSession: a successful fetch here
          // proves the portal is reachable again, so clear the global historyError too.
          historyError: null,
        };
      });
      if (overlay.length === 0) {
        setSessionHistorySync(set, sessionId, null);
      }
    } catch {
      // keep overlay; flush will retry
    }
  },

  removePendingMessage(messageId) {
    set((state) => ({
      pendingMessages: state.pendingMessages.filter((message) => message.id !== messageId),
    }));
  },

  editPendingMessage(messageId, content) {
    const trimmed = content.trim();
    if (!trimmed) return;
    set((state) => ({
      pendingMessages: state.pendingMessages.map((message) =>
        message.id === messageId ? { ...message, content: trimmed } : message
      ),
    }));
  },

  async resumePlanChatFromComposer(content) {
    const text = content.trim();
    if (!text) return false;
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return false;
    const planChatGate = findActivePlanChatGate(state.messages, sessionId);
    if (!planChatGate) return false;

    const tenantId =
      state.sessions.find((session) => session.id === sessionId)?.tenant_id ?? DEFAULT_TENANT;
    const userId =
      state.sessions.find((session) => session.id === sessionId)?.user_id ?? DEFAULT_USER;
    const userMessage: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    set((prev) => ({
      messages: prev.messages
        .map((message) => {
          if (message.id !== planChatGate.assistantMessageId || !message.deep_research) {
            return message;
          }
          return {
            ...message,
            deep_research: {
              ...message.deep_research,
              status: "awaiting_clarify",
              events: [
                ...(message.deep_research.events ?? []),
                {
                  type: "narrative" as const,
                  text: "正在根据你的反馈更新计划…",
                },
              ].slice(-200),
            },
          };
        })
        .concat(userMessage),
      errorMessage: null,
      planChatRevising: true,
      // 清掉本会话排队，避免随后「立即发送」取消流并开新一轮。
      pendingMessages: prev.pendingMessages.filter((m) => m.sessionId !== sessionId),
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              message_count: session.message_count + 1,
              last_message_at: now(),
              updated_at: now(),
            }
          : session,
      ),
    }));
    if (get().hydrated) {
      void persistAppendMessages(set, sessionId, [userMessage]);
    }
    const clearPlanChatUpdating = () => {
      set((prev) => ({
        messages: prev.messages.map((message) => {
          if (message.id !== planChatGate.assistantMessageId || !message.deep_research) {
            return message;
          }
          const events = (message.deep_research.events ?? []).filter(
            (event) =>
              !(
                event.type === "narrative" &&
                /正在根据你的反馈更新计划/.test(event.text)
              ),
          );
          return {
            ...message,
            deep_research: { ...message.deep_research, events },
          };
        }),
      }));
    };
    try {
      const result = await postPlanChatComposerReply({
        runId: planChatGate.runId,
        chatReply: text,
        plan: planChatGate.plan,
        sessionId,
        topic: planChatGate.topic || text,
        model: get().activeModel?.trim() || undefined,
      });
      if (result.kind === "error") {
        clearPlanChatUpdating();
        set({ errorMessage: result.message, planChatRevising: false });
        return true;
      }
      if (result.kind === "already_continued") {
        clearPlanChatUpdating();
        set({ errorMessage: result.message, planChatRevising: false });
        return true;
      }
      // resumed：旧卡冻结，用户反馈下方追加「新一版方案卡」（不要在同一张卡上改 v2）。
      if (result.plan && result.plan.subQuestions.length > 0) {
        const nextVersion = result.version ?? result.plan.version;
        const keepVersionMax = planChatGate.plan.version ?? 1;
        let appended: ChatMessage | null = null;
        set((prev) => {
          if (
            sessionHasPlanChatVersion(
              prev.messages,
              sessionId,
              planChatGate.runId,
              nextVersion,
            )
          ) {
            return {
              messages: prev.messages.map((message) => {
                if (message.id !== planChatGate.assistantMessageId || !message.deep_research) {
                  return message;
                }
                return {
                  ...message,
                  deep_research: freezePlanChatSourceDeepResearch(
                    message.deep_research,
                    keepVersionMax,
                  ),
                };
              }),
              errorMessage: null,
              planChatRevising: false,
            };
          }
          const source = prev.messages.find(
            (m) => m.id === planChatGate.assistantMessageId,
          );
          const userCreatedMs = Date.parse(userMessage.created_at) || Date.now();
          appended = buildPlanChatRevisionAssistantMessage({
            id: makeId(),
            sessionId,
            tenantId,
            userId,
            runId: planChatGate.runId,
            plan: result.plan!,
            version: nextVersion,
            profile: source?.deep_research?.profile,
            // 保证刷新后 ORDER BY created_at 仍是：改计划用户话 → 新方案卡
            createdAt: new Date(userCreatedMs + 1).toISOString(),
          });
          return {
            messages: [
              ...prev.messages.map((message) => {
                if (message.id !== planChatGate.assistantMessageId || !message.deep_research) {
                  return message;
                }
                return {
                  ...message,
                  deep_research: freezePlanChatSourceDeepResearch(
                    message.deep_research,
                    keepVersionMax,
                  ),
                };
              }),
              appended,
            ],
            errorMessage: null,
            planChatRevising: false,
            sessions: prev.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    message_count: session.message_count + 1,
                    last_message_at: now(),
                    updated_at: now(),
                  }
                : session,
            ),
          };
        });
        if (appended && get().hydrated) {
          void persistAppendMessages(set, sessionId, [appended]);
        }
        return true;
      }
      // 兼容旧响应：无 plan 体时再 hydrate 回填。
      const baselineVersion = planChatGate.plan.version ?? 1;
      void (async () => {
        try {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const detail = await fetchPlanChatRunDetail(planChatGate.runId, sessionId);
            const events = detail?.events;
            if (!events?.length) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
            const latestPlan = latestResearchPlanFromEvents(events);
            const versionAdvanced =
              !!latestPlan &&
              (latestPlan.version > baselineVersion || latestPlan.action === "approved");
            if (!versionAdvanced || !latestPlan) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
            let appended: ChatMessage | null = null;
            set((prev) => {
              if (
                sessionHasPlanChatVersion(
                  prev.messages,
                  sessionId,
                  planChatGate.runId,
                  latestPlan.version,
                )
              ) {
                return {
                  messages: prev.messages.map((message) => {
                    if (message.id !== planChatGate.assistantMessageId || !message.deep_research) {
                      return message;
                    }
                    return {
                      ...message,
                      deep_research: freezePlanChatSourceDeepResearch(
                        message.deep_research,
                        baselineVersion,
                      ),
                    };
                  }),
                  errorMessage: null,
                  planChatRevising: false,
                };
              }
              const source = prev.messages.find(
                (m) => m.id === planChatGate.assistantMessageId,
              );
              appended = buildPlanChatRevisionAssistantMessage({
                id: makeId(),
                sessionId,
                tenantId,
                userId,
                runId: planChatGate.runId,
                plan: latestPlan.plan,
                version: latestPlan.version,
                profile: source?.deep_research?.profile,
              });
              return {
                messages: [
                  ...prev.messages.map((message) => {
                    if (message.id !== planChatGate.assistantMessageId || !message.deep_research) {
                      return message;
                    }
                    return {
                      ...message,
                      deep_research: freezePlanChatSourceDeepResearch(
                        message.deep_research,
                        baselineVersion,
                      ),
                    };
                  }),
                  appended,
                ],
                errorMessage: null,
                planChatRevising: false,
                sessions: prev.sessions.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        message_count: session.message_count + 1,
                        last_message_at: now(),
                        updated_at: now(),
                      }
                    : session,
                ),
              };
            });
            if (appended && get().hydrated) {
              void persistAppendMessages(set, sessionId, [appended]);
            }
            return;
          }
          clearPlanChatUpdating();
          set({
            errorMessage: "计划仍在更新或未同步成功，请稍后重试，或直接点「开始调研」。",
            planChatRevising: false,
          });
        } catch {
          clearPlanChatUpdating();
          set({ errorMessage: "计划更新同步失败，请重试。", planChatRevising: false });
        }
      })();
    } catch {
      clearPlanChatUpdating();
      set({ errorMessage: "网络异常，计划更新失败，请重试。", planChatRevising: false });
    }
    return true;
  },

  async sendQueuedMessageNow(client, messageId) {
    const item = get().pendingMessages.find((message) => message.id === messageId);
    if (!item) return;
    set((state) => ({
      pendingMessages: state.pendingMessages.filter((message) => message.id !== messageId),
    }));
    // 计划对齐中：排队消息也只改计划，禁止 forceSend 打断原 run。
    if (findActivePlanChatGate(get().messages, item.sessionId)) {
      await get().resumePlanChatFromComposer(item.content);
      return;
    }
    await get().sendMessage(
      client,
      {
        content: item.content,
        attachments: item.attachments,
        webSearch: get().lastWebSearchBySessionId[item.sessionId],
        deepResearch: get().lastDeepResearchBySessionId[item.sessionId],
      },
      { forceSend: true }
    );
  },

  async hydrateSessions() {
    if (chatHydrateInFlight) {
      await chatHydrateInFlight;
      return;
    }
    if (get().hydrated) return;

    const stateAtStart = get();
    const selectionSeq = sessionMessageLoadSeq;
    const initialSessionIds = new Set(stateAtStart.sessions.map((session) => session.id));
    const hadExplicitSelection = Boolean(
      stateAtStart.messages.length > 0 ||
        (stateAtStart.activeSessionId &&
          stateAtStart.activeSessionId !== stateAtStart.draftSessionId),
    );

    chatHydrateInFlight = (async () => {
      set({ historyLoading: true, historyError: null });
      const keepCurrentSelection = (): boolean => {
        const live = get();
        const actedDuring =
          selectionSeq !== sessionMessageLoadSeq ||
          live.activeSessionId !== stateAtStart.activeSessionId ||
          live.draftSessionId !== stateAtStart.draftSessionId ||
          live.messages.length !== stateAtStart.messages.length;
        if (!hadExplicitSelection && !actedDuring) return false;
        set({ hydrated: true, historyLoading: false, historyError: null });
        const selectedId = get().activeSessionId;
        const hasLocalMessages = selectedId
          ? get().messages.some((message) => message.session_id === selectedId)
          : false;
        if (
          selectedId &&
          !isDraftSessionId(get(), selectedId) &&
          get().sessions.some((session) => session.id === selectedId) &&
          !hasLocalMessages &&
          !isSessionStreaming(get(), selectedId)
        ) {
          void get().switchSession(selectedId);
        }
        historyAuthRedirectScheduled = false;
        void flushHistoryOutbox().then(async (sessionIds) => {
          for (const id of sessionIds) {
            await get().refetchSessionMessages(id);
          }
        });
        return true;
      };
      try {
        const firstPage = await portalHistory.listSessionsPage({ limit: HISTORY_PAGE_SIZE });
        const sessions = sortSessionsForHistory(firstPage.sessions);
        set((prev) => {
          const pageIds = new Set(sessions.map((session) => session.id));
          const addedDuringLoad = prev.sessions.filter(
            (session) => !initialSessionIds.has(session.id) && !pageIds.has(session.id),
          );
          return {
            sessions: sortSessionsForHistory([...sessions, ...addedDuringLoad]),
            historyNextCursor: firstPage.nextCursor,
            historyLoading: false,
            historyListLoaded: true,
            historyLoadMoreError: null,
            historyError: null,
          };
        });
        if (keepCurrentSelection()) return;
        if (sessions.length === 0) {
          set((prev) => ({
            ...beginDraftSessionPatch(prev),
            sessions: [],
            hydrated: true,
            historyLoading: false,
            historyNextCursor: firstPage.nextCursor,
            historyError: null,
          }));
          historyAuthRedirectScheduled = false;
          void flushHistoryOutbox();
          return;
        }
        const availableSessions = new Map(sessions.map((session) => [session.id, session]));
        const ensureSessionAvailable = async (sessionId: string): Promise<boolean> => {
          if (availableSessions.has(sessionId)) return true;
          const alreadyLoaded = get().sessions.find((session) => session.id === sessionId);
          if (alreadyLoaded) {
            availableSessions.set(sessionId, alreadyLoaded);
            return true;
          }
          try {
            const session = await portalHistory.getSession(sessionId);
            if (session.id !== sessionId) return false;
            availableSessions.set(session.id, session);
            set((prev) => ({
              sessions: prev.sessions.some((item) => item.id === session.id)
                ? prev.sessions
                : sortSessionsForHistory([...prev.sessions, session]),
            }));
            return true;
          } catch {
            return false;
          }
        };
        const rememberedId = readLastActiveSessionId();
        let preferredId = sessions[0]!.id;
        const runsPromise = fetchActiveDeepResearchRuns(null);
        const rememberedReady = rememberedId
          ? ensureSessionAvailable(rememberedId)
          : Promise.resolve(false);
        const loadMessages = async (sessionId: string) => {
          const [remoteMessages, overlay] = await Promise.all([
            portalHistory.getMessages(sessionId),
            listPendingOverlayMessages(sessionId),
          ]);
          return hydrateMessagesDeepResearch(
            sessionId,
            mergeOverlayMessages(remoteMessages, overlay),
          );
        };
        if (rememberedId && availableSessions.has(rememberedId)) preferredId = rememberedId;
        let messagesPromise = loadMessages(preferredId);
        const [activeRuns, rememberedOk] = await Promise.all([runsPromise, rememberedReady]);
        if (rememberedId && rememberedOk && preferredId !== rememberedId) {
          void messagesPromise.catch(() => undefined);
          preferredId = rememberedId;
          messagesPromise = loadMessages(preferredId);
        }
        const runSessionId = activeRuns[0]?.sessionId?.trim();
        if (runSessionId && runSessionId !== preferredId && await ensureSessionAvailable(runSessionId)) {
          void messagesPromise.catch(() => undefined);
          preferredId = runSessionId;
          messagesPromise = loadMessages(preferredId);
        }
        if (keepCurrentSelection()) return;
        const merged = await messagesPromise;
        if (keepCurrentSelection()) return;
        const activeSession = availableSessions.get(preferredId) ?? sessions[0]!;
        const responseVersions = buildHydratedResponseVersions(merged);
        writeLastActiveSessionId(activeSession.id);
        set({
          activeSessionId: activeSession.id,
          draftSessionId: null,
          messages: merged,
          hydrated: true,
          historyLoading: false,
          historyError: null,
          activeModel: activeSession.active_model ?? get().activeModel ?? DEFAULT_MODEL,
          status: "idle",
          activeRequestId: null,
          errorMessage: null,
          sessionTokens: { ...EMPTY_USAGE },
          sessionTokensBySessionId: { [activeSession.id]: { ...EMPTY_USAGE } },
          responseVersionsByUserMessageId: responseVersions,
        });
        historyAuthRedirectScheduled = false;
        void flushHistoryOutbox().then(async (sessionIds) => {
          for (const id of sessionIds) {
            await get().refetchSessionMessages(id);
          }
        });
      } catch (error) {
        const message = resolveHistoryErrorMessage(error, "加载历史失败");
        const unauthorized = message === "登录已过期，请重新登录";
        set({
          historyLoading: false,
          historyError: message,
          hydrated: unauthorized ? false : get().hydrated,
        });
      } finally {
        chatHydrateInFlight = null;
      }
    })();

    await chatHydrateInFlight;
  },

  async loadMoreSessions() {
    const cursor = get().historyNextCursor;
    if (!cursor) return;
    if (historyPageLoadInFlight) return historyPageLoadInFlight;
    set({ historyLoadingMore: true, historyLoadMoreError: null });
    const pending = (async () => {
      try {
        const page = await portalHistory.listSessionsPage({
          limit: HISTORY_PAGE_SIZE,
          cursor,
        });
        if (get().historyNextCursor !== cursor) return;
        set((prev) => {
          const merged = new Map(prev.sessions.map((session) => [session.id, session]));
          for (const session of page.sessions) {
            if (!merged.has(session.id)) merged.set(session.id, session);
          }
          return {
            sessions: sortSessionsForHistory([...merged.values()]),
            historyNextCursor: page.nextCursor,
            historyLoadMoreError: null,
          };
        });
      } catch (error) {
        set({ historyLoadMoreError: resolveHistoryErrorMessage(error, "加载更多历史失败") });
      } finally {
        set({ historyLoadingMore: false });
      }
    })();
    historyPageLoadInFlight = pending;
    try {
      await pending;
    } finally {
      if (historyPageLoadInFlight === pending) historyPageLoadInFlight = null;
    }
  },

  bootstrap(params) {
    if (get().hydrated) return;
    set({
      ...beginDraftSessionPatch(get(), params),
      sessions: [],
      hydrated: false,
    });
  },

  async createSession(params) {
    sessionMessageLoadSeq += 1;
    if (!get().hydrated) {
      set((prev) => ({
        ...beginDraftSessionPatch(prev, params),
        sessions: prev.sessions,
      }));
      return;
    }

    set((prev) => ({
      ...beginDraftSessionPatch(prev, params),
      sessions: prev.sessions,
    }));
  },

  async switchSession(sessionId) {
    if (isDraftSessionId(get(), sessionId)) return;
    const target = get().sessions.find((session) => session.id === sessionId);
    if (!target) return;
    const tokens = get().sessionTokensBySessionId[sessionId] ?? { ...EMPTY_USAGE };
    if (!get().hydrated) {
      set((prev) => ({
        ...discardDraftSessionPatch(prev),
        activeSessionId: sessionId,
        activeModel: target.active_model ?? DEFAULT_MODEL,
        ...topLevelStreamFieldsForSession(prev, sessionId),
        errorMessage: null,
        sessionTokens: { ...tokens },
      }));
      return;
    }

    const targetIsStreaming = isSessionStreaming(get(), sessionId);
    const loadSeq = ++sessionMessageLoadSeq;
    writeLastActiveSessionId(sessionId);
    set((prev) => ({
      ...discardDraftSessionPatch(prev),
      activeSessionId: sessionId,
      activeModel: target.active_model ?? DEFAULT_MODEL,
      ...topLevelStreamFieldsForSession(prev, sessionId),
      errorMessage: null,
      sessionTokens: { ...tokens },
      sessionMessagesLoading: targetIsStreaming ? false : true,
    }));

    // 目标 session 正在流式：内存中的 partial 尚未落库，跳过远端 fetch
    // 否则 portalHistory.getMessages 的旧快照会覆盖正在流的 assistant 消息
    if (targetIsStreaming) return;

    try {
      const remoteMessages = await portalHistory.getMessages(sessionId);
      const overlay = await listPendingOverlayMessages(sessionId);
      const merged = await hydrateMessagesDeepResearch(
        sessionId,
        mergeOverlayMessages(remoteMessages, overlay),
      );
      const responseVersions = buildHydratedResponseVersions(merged);
      if (loadSeq !== sessionMessageLoadSeq || get().activeSessionId !== sessionId) return;
      set((state) => ({
        messages: mergeSessionMessages(state.messages, sessionId, merged),
        responseVersionsByUserMessageId: {
          ...stripVersionsForSession(state, sessionId),
          ...responseVersions,
        },
        sessionMessagesLoading: false,
        // historyError is a global banner (not scoped to a session): a successful switch
        // proves connectivity has recovered, so clear it here too. Otherwise one earlier
        // transient failure keeps the "历史同步" banner stuck on every session until a
        // full page refresh re-runs hydrateSessions (the only other place that clears it).
        historyError: null,
      }));
      void flushHistoryOutbox().then(async (sessionIds) => {
        for (const id of sessionIds) {
          await get().refetchSessionMessages(id);
        }
      });
    } catch (error) {
      if (loadSeq !== sessionMessageLoadSeq || get().activeSessionId !== sessionId) return;
      set({
        sessionMessagesLoading: false,
        historyError: resolveHistoryErrorMessage(error, "加载消息失败"),
      });
    }
  },

  async renameSession(sessionId, title) {
    if (isDraftSessionId(get(), sessionId)) return;
    const nextTitle = title.trim() || "New chat";
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, title: nextTitle, updated_at: now() } : session,
      ),
    }));
    if (!get().hydrated) return;
    try {
      const updated = await portalHistory.renameSession(sessionId, nextTitle);
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === sessionId ? updated : s)),
      }));
    } catch (error) {
      set({ historyError: resolveHistoryErrorMessage(error, "重命名失败") });
    }
  },

  async pinSession(sessionId, pinned) {
    if (isDraftSessionId(get(), sessionId)) return;
    const optimisticAt = pinned ? now() : undefined;
    set((state) => ({
      sessions: sortSessionsForHistory(
        state.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, pinned_at: optimisticAt, updated_at: now() }
            : session,
        ),
      ),
    }));
    if (!get().hydrated) return;
    try {
      const updated = await portalHistory.pinSession(sessionId, pinned);
      set((state) => ({
        sessions: sortSessionsForHistory(
          state.sessions.map((session) => (session.id === sessionId ? updated : session)),
        ),
      }));
    } catch (error) {
      set({ historyError: resolveHistoryErrorMessage(error, "置顶失败") });
      void get().hydrateSessions();
    }
  },

  async deleteSession(sessionId) {
    if (isDraftSessionId(get(), sessionId)) return;
    await get().deleteSessions([sessionId]);
  },

  async deleteSessions(sessionIds) {
    const ids = [
      ...new Set(
        sessionIds.filter((id) => id && !isDraftSessionId(get(), id)),
      ),
    ];
    if (ids.length === 0) return;

    if (get().hydrated) {
      try {
        if (ids.length === 1) {
          await portalHistory.deleteSession(ids[0]!);
        } else {
          await portalHistory.deleteSessions(ids);
        }
        await markSessionsDeleted(ids);
      } catch (error) {
        set({ historyError: resolveHistoryErrorMessage(error, "删除失败") });
        return;
      }
    } else {
      await markSessionsDeleted(ids);
    }

    const idSet = new Set(ids);
    const willBeEmpty = get().sessions.filter((s) => !idSet.has(s.id)).length === 0;

    set((state) => {
      const removedUserIds = new Set(
        state.messages
          .filter((message) => idSet.has(message.session_id) && message.role === "user")
          .map((message) => message.id),
      );
      const nextMessages = state.messages.filter((message) => !idSet.has(message.session_id));
      const nextSessions = state.sessions.filter((session) => !idSet.has(session.id));
      const nextTokensMap = { ...state.sessionTokensBySessionId };
      for (const id of ids) {
        delete nextTokensMap[id];
      }
      const nextVersions = { ...state.responseVersionsByUserMessageId };
      for (const id of removedUserIds) {
        delete nextVersions[id];
      }
      let nextActive = state.activeSessionId;
      if (nextActive && idSet.has(nextActive)) {
        nextActive = nextSessions[0]?.id ?? null;
      }
      const nextTarget = nextSessions.find((session) => session.id === nextActive);
      const nextSessionTokens = nextActive ? (nextTokensMap[nextActive] ?? { ...EMPTY_USAGE }) : { ...EMPTY_USAGE };

      if (willBeEmpty && state.hydrated) {
        return {
          ...beginDraftSessionPatch(state, { defaultModel: state.activeModel }),
          sessions: [],
        };
      }

      return {
        sessions: nextSessions,
        activeSessionId: nextActive,
        messages: nextMessages,
        sessionTokensBySessionId: nextTokensMap,
        responseVersionsByUserMessageId: nextVersions,
        activeModel: nextTarget?.active_model ?? state.activeModel,
        sessionTokens: nextSessionTokens,
        status: "idle",
        activeRequestId: null,
        errorMessage: null,
      };
    });
  },

  switchModel(model) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (isDraftSessionId(state, sessionId)) {
      if (state.activeModel === model) return;
      probeNote("store.switchModel", { model, draft: true });
      set({ activeModel: model });
      return;
    }
    const session = state.sessions.find((item) => item.id === sessionId);
    if (state.activeModel === model && session?.active_model === model) {
      return;
    }
    probeNote("store.switchModel", { model, sessionId });
    set((prev) => ({
      activeModel: model,
      sessions: prev.sessions.map((item) =>
        item.id === prev.activeSessionId
          ? {
              ...item,
              active_model: model,
              updated_at: now(),
            }
          : item
      ),
    }));
    if (get().hydrated && sessionId) {
      void portalHistory.patchSession(sessionId, { activeModel: model }).catch((error) => {
        set({ historyError: resolveHistoryErrorMessage(error, "更新模型失败") });
      });
    }
  },

  async sendMessage(client, input, options) {
    const state = get();
    const requestedSessionId = options?.targetSessionId?.trim() || state.activeSessionId;
    if (!requestedSessionId) return;
    let sessionId = requestedSessionId;
    if (
      options?.targetSessionId &&
      !isDraftSessionId(state, sessionId) &&
      !state.sessions.some((session) => session.id === sessionId)
    ) {
      return;
    }
    let requestModel =
      state.sessions.find((session) => session.id === sessionId)?.active_model ?? state.activeModel;

    const content = input.content.trim();
    const attachments =
      input.attachments?.filter(
        (item) => item.data_url?.trim() || item.parsed_text?.trim() || item.kind === "video",
      ) ?? [];
    if (!content && attachments.length === 0) return;

    // Claim a draft synchronously, before the plan-chat gate below can yield.
    // A repeated submit during session creation is ignored; once this turn is
    // accepted, normal sending/streaming queue behavior takes over.
    const claimedDraftId = isDraftSessionId(state, sessionId) ? sessionId : null;
    if (claimedDraftId && draftSubmissionInFlight.has(claimedDraftId)) return;
    if (claimedDraftId) {
      draftSubmissionInFlight.add(claimedDraftId);
      sessionMessageLoadSeq += 1;
    }
    let ownsDraftClaim = Boolean(claimedDraftId);
    const releaseDraftClaim = () => {
      if (!ownsDraftClaim || !claimedDraftId) return;
      draftSubmissionInFlight.delete(claimedDraftId);
      ownsDraftClaim = false;
    };

    // Best-effort outbox flush before a new turn; do not block typing/send.
    void flushHistoryOutbox({ timeoutMs: 800 });

    let queueSessionId = sessionId;
    let userMessage: ChatMessage | undefined;
    let assistantMessage: ChatMessage | undefined;
    let webSearchEnabled = false;
    let deepResearchEnabled = false;
    let nextSessionMessages: ChatMessage[] = [];
    let sendingId = "";
    let ownedRequestId = "";
    try {
      // 计划对齐 gate：主输入只改计划；含 forceSend 也绝不能 cancel + 新开一轮。
      if (content && (await get().resumePlanChatFromComposer(content))) {
        return;
      }

      if (shouldEnqueueOnResend({ isStreamActive: isSessionStreaming(state, sessionId), forceSend: options?.forceSend })) {
        const enqueueSessionId = sessionId;
        set((prev) => ({
          pendingMessages: [
            ...prev.pendingMessages,
            {
              id: makeId(),
              sessionId: enqueueSessionId,
              content: content || "（附件）",
              attachments: attachments.length > 0 ? attachments : undefined,
              timestamp: Date.now(),
            },
          ],
        }));
        notifyMessageAccepted(options?.onAccepted, enqueueSessionId);
        return;
      }

      if (options?.forceSend && isSessionStreaming(get(), sessionId)) {
        await get().cancel(client);
      }

      if (claimedDraftId) {
        if (canPersistHistory(get())) {
          try {
            const created = await portalHistory.createSession({
              title: buildAutoTitleFromFirstUserMessage(content) || "New chat",
              activeModel: requestModel,
            });
            sessionId = created.id;
            requestModel = created.active_model ?? requestModel;
            set((prev) => {
              const draftTokens = prev.sessionTokensBySessionId[claimedDraftId] ?? { ...EMPTY_USAGE };
              const nextTokensMap = { ...prev.sessionTokensBySessionId };
              delete nextTokensMap[claimedDraftId];
              nextTokensMap[created.id] = draftTokens;
              const stillOnDraft = prev.activeSessionId === claimedDraftId;
              return {
                draftSessionId: prev.draftSessionId === claimedDraftId ? null : prev.draftSessionId,
                activeSessionId: stillOnDraft ? created.id : prev.activeSessionId,
                sessions: [...prev.sessions, created],
                sessionTokensBySessionId: nextTokensMap,
                ...(stillOnDraft ? { sessionTokens: draftTokens } : {}),
              };
            });
          } catch (error) {
            const message = resolveHistoryErrorMessage(error, "创建会话失败");
            set({
              historyError: message,
              hydrated: message === "登录已过期，请重新登录" ? false : get().hydrated,
            });
            return;
          }
        } else {
          const promoted: ChatSession = {
            id: sessionId,
            tenant_id: input.tenantId ?? DEFAULT_TENANT,
            user_id: input.userId ?? DEFAULT_USER,
            title: buildAutoTitleFromFirstUserMessage(content) || "New chat",
            active_model: requestModel,
            message_count: 0,
            created_at: now(),
            updated_at: now(),
          };
          set((prev) => ({
            draftSessionId: prev.draftSessionId === claimedDraftId ? null : prev.draftSessionId,
            sessions: [...prev.sessions, promoted],
          }));
        }
      }

      queueSessionId = sessionId;

    const latest = get();
    const tenantId = input.tenantId ?? latest.sessions.find((session) => session.id === sessionId)?.tenant_id ?? DEFAULT_TENANT;
    const userId = input.userId ?? latest.sessions.find((session) => session.id === sessionId)?.user_id ?? DEFAULT_USER;
    const createdAtPair = pairedCreatedAt();
    const stagedUser: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      created_at: createdAtPair.user,
    };
    userMessage = stagedUser;
    webSearchEnabled = Boolean(input.webSearch);
    deepResearchEnabled = Boolean(input.deepResearch);
    const stagedAssistant: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: requestModel,
      created_at: createdAtPair.assistant,
      ...(deepResearchEnabled
        ? {
            deep_research: {
              runId: "pending",
              status: "running" as const,
              events: [],
              artifactIds: [],
            },
          }
        : {}),
    };
    assistantMessage = stagedAssistant;

    const sessionMessages = getSessionMessages(latest.messages, sessionId);
    nextSessionMessages = [...sessionMessages, stagedUser, stagedAssistant];
    const priorUserCount = sessionMessages.filter((m) => m.role === "user").length;
    const shouldAutoTitle = priorUserCount === 0;
    set((prev) => ({
      messages: mergeSessionMessages(prev.messages, sessionId, nextSessionMessages),
      errorMessage: null,
      lastWebSearchBySessionId: {
        ...prev.lastWebSearchBySessionId,
        [sessionId]: webSearchEnabled,
      },
      lastSkillIdBySessionId: {
        ...prev.lastSkillIdBySessionId,
        ...(Object.prototype.hasOwnProperty.call(input, "skillId")
          ? { [sessionId]: input.skillId?.trim() ?? "" }
          : {}),
      },
      lastDeepResearchBySessionId: {
        ...prev.lastDeepResearchBySessionId,
        [sessionId]: deepResearchEnabled,
      },
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [stagedUser.id]: {
          versions: [toAssistantVersion(stagedAssistant, { queryVersionIndex: 0, retryAttempt: 0, queryText: content })],
          activeIndex: 0,
          activeAssistantIndexByQueryVersion: { 0: 0 },
        },
      },
      sessions: prev.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const autoTitle =
          shouldAutoTitle && sessionTitleNeedsAutoFill(session.title)
            ? buildAutoTitleFromFirstUserMessage(content) || session.title
            : session.title;
        return {
          ...session,
          title: autoTitle,
          message_count: session.message_count + 2,
          last_message_at: now(),
          updated_at: now(),
        };
      }),
    }));
    if (get().activeSessionId === sessionId) writeLastActiveSessionId(sessionId);
    sendingId = makeId();
    ownedRequestId = sendingId;
    setSessionStream(set, sessionId, {
      status: "sending",
      activeRequestId: sendingId,
      assistantMessageId: assistantMessage.id,
    });
    notifyMessageAccepted(options?.onAccepted, sessionId);
    } finally {
      releaseDraftClaim();
    }
    if (!userMessage || !assistantMessage) return;

    // Deep research can run for minutes; refresh aborts SSE before the old
    // end-of-stream persist. Shell must hit history immediately so the turn
    // survives reload (workbench reattached via run-store hydrate / checkpoints).
    if (deepResearchEnabled && canPersistHistory(get())) {
      void persistAppendMessages(set, sessionId, [userMessage, assistantMessage]);
    }

    const streamWriter = deepResearchEnabled
      ? null
      : createAssistantStreamWriter(
          set,
          get,
          sessionId,
          assistantMessage.id,
          userMessage.id,
          () => getSessionRequestId(get(), sessionId) === ownedRequestId,
        );
    const ordinaryCheckpoint = deepResearchEnabled
      ? null
      : checkpointOrdinaryResponse(
          set,
          get,
          sessionId,
          userMessage.id,
          assistantMessage.id,
          () => getSessionRequestId(get(), sessionId) === ownedRequestId,
        );

    const checkpointDeepResearchTurn = (force = false) => {
      if (!deepResearchEnabled || !canPersistHistory(get())) return;
      const nowTs = Date.now();
      const last = deepResearchCheckpointAtByAssistantId.get(assistantMessage.id) ?? 0;
      if (!force && nowTs - last < DEEP_RESEARCH_CHECKPOINT_MS) return;
      deepResearchCheckpointAtByAssistantId.set(assistantMessage.id, nowTs);
      const snap = get();
      const u = snap.messages.find((m) => m.id === userMessage.id);
      const a = snap.messages.find((m) => m.id === assistantMessage.id);
      if (u?.role === "user" && a?.role === "assistant") {
        void persistAppendMessages(set, sessionId, [u, a]);
      }
    };

    let streamEndedCleanly = false;
    let streamHadError = false;
    let streamCancelled = false;
    let streamFinishReason: string | undefined;
    try {
      const request = toSdkRequest(
        sessionId,
        get().activeModel,
        nextSessionMessages,
        webSearchEnabled,
        deepResearchEnabled,
        getDeepResearchInteractionPref(),
        get().lastSkillIdBySessionId[sessionId],
      );
      const { requestId, traceId } = await client.sendMessage(request);
      if (getSessionRequestId(get(), sessionId) !== sendingId) {
        await client.cancel(requestId);
        return;
      }
      ownedRequestId = requestId;
      setSessionStream(set, sessionId, {
        status: "streaming",
        activeRequestId: requestId,
        assistantMessageId: assistantMessage.id,
      });
      // trace_id 是跨服务关联键（requestId 只是前端内存句柄，不出浏览器）。
      // 挂到助手消息上，供气泡「复制请求 ID」与落库后的排障检索。
      if (traceId) {
        set((prev) => ({
          messages: prev.messages.map((message) =>
            message.id === assistantMessage.id ? { ...message, trace_id: traceId } : message,
          ),
        }));
      }

      for await (const chunk of client.stream(requestId)) {
        if (getSessionRequestId(get(), sessionId) !== ownedRequestId) return;
        const finishReason = readFinishReason(chunk);
        if (finishReason) streamFinishReason = finishReason;
        if (!chunk.delta || chunk.error || chunk.cancelled || chunk.done) streamWriter?.flush();

        if (chunk.cancelled) {
          streamCancelled = true;
          if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
            setSessionStream(set, sessionId, null);
            set((prev) => (prev.activeSessionId === sessionId ? { errorMessage: null } : {}));
          }
          break;
        }

        if (chunk.error) {
          streamHadError = true;
          const settled = streamErrorNotice(chunk.error, chunk.traceId);
          appendStreamErrorToAssistant(
            set,
            assistantMessage.id,
            userMessage.id,
            settled.notice,
            settled.reason,
          );
          setSessionStream(set, sessionId, null);
          set((prev) =>
            prev.activeSessionId === sessionId
              ? { status: "error" as const, errorMessage: settled.notice }
              : {},
          );
          return;
        }

        if (chunk.delta) {
          probeNote("stream.delta", { sessionId, assistantId: assistantMessage.id, n: chunk.delta.length });
          if (streamWriter) {
            streamWriter.push(chunk.delta);
          } else {
            set((prev) => {
              const current = prev.responseVersionsByUserMessageId[userMessage.id];
              const nextVersionState = current
                ? {
                    ...current,
                    versions: current.versions.map((version, index) =>
                      index === current.activeIndex ? { ...version, content: `${version.content}${chunk.delta}` } : version
                    ),
                  }
                : undefined;

              return {
                messages: prev.messages.map((message) =>
                  message.id === assistantMessage.id ? { ...message, content: `${message.content}${chunk.delta}` } : message
                ),
                responseVersionsByUserMessageId: nextVersionState
                  ? {
                      ...prev.responseVersionsByUserMessageId,
                      [userMessage.id]: nextVersionState,
                    }
                  : prev.responseVersionsByUserMessageId,
              };
            });
          }
          ordinaryCheckpoint?.changed();
        }

        if (chunk.usage) {
          set((prev) => {
            const nextTokens = addChunkToSessionTokens(prev.sessionTokens, chunk.usage ?? {});
            const prevForSession = prev.sessionTokensBySessionId[sessionId] ?? { ...EMPTY_USAGE };
            const nextForSession = addChunkToSessionTokens(prevForSession, chunk.usage ?? {});
            return {
              sessionTokens: nextTokens,
              sessionTokensBySessionId: {
                ...prev.sessionTokensBySessionId,
                [sessionId]: nextForSession,
              },
            };
          });
        }

        if (chunk.webSearchSources?.length) {
          applyWebSearchSourcesToAssistant(set, assistantMessage.id, userMessage.id, chunk.webSearchSources);
        }

        if (chunk.deepResearchEvent) {
          applyDeepResearchEventToAssistant(
            set,
            assistantMessage.id,
            userMessage.id,
            chunk.deepResearchEvent,
          );
          const evType = chunk.deepResearchEvent.type;
          const forceCheckpoint =
            evType === "run_started" ||
            evType === "clarify" ||
            evType === "clarify_chat" ||
            evType === "phase" ||
            evType === "lane_started";
          checkpointDeepResearchTurn(forceCheckpoint);
        }

        if (chunk.done) {
          streamWriter?.flush();
          streamEndedCleanly = true;
          if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
            setSessionStream(set, sessionId, null);
          }
        }
      }

      streamWriter?.flush();
      settleOrdinaryTerminal(
        set,
        get,
        sessionId,
        assistantMessage.id,
        userMessage.id,
        deepResearchEnabled,
        streamCancelled,
        streamFinishReason,
      );
    } catch (error) {
      try {
        streamWriter?.flush();
      } catch {
        // A buffered write failure is reported on the next push; keep the turn's own error.
      }
      if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
        const streamErrorMessage = toStreamCatchErrorMessage(error);
        appendStreamErrorToAssistant(set, assistantMessage.id, userMessage.id, streamErrorMessage, "failed");
        streamHadError = true;
        setSessionStream(set, sessionId, null);
        set((prev) =>
          prev.activeSessionId === sessionId
            ? { status: "error" as const, errorMessage: streamErrorMessage }
            : {},
        );
      }
    } finally {
      streamWriter?.stop();
      ordinaryCheckpoint?.stop();
      // Persist turn: deep-research always (incl. refresh abort). Ordinary chat
      // persists a clean end or a failed/disconnected answer; cancel persists itself.
      if (canPersistHistory(get())) {
        const after = get();
        const currentRequest = getSessionRequestId(after, sessionId);
        const stillOwner = !currentRequest || currentRequest === ownedRequestId;
        const u = after.messages.find((m) => m.id === userMessage.id);
        const a = after.messages.find((m) => m.id === assistantMessage.id);
        const shouldPersist =
          u?.role === "user" &&
          a?.role === "assistant" &&
          stillOwner &&
          (deepResearchEnabled
            ? true
            : a.interruption?.reason !== "cancelled" &&
              (streamEndedCleanly || streamHadError || Boolean(a.interruption)));
        if (shouldPersist) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await persistAppendMessages(set, sessionId, [u, a]);
        }
      }
      deepResearchCheckpointAtByAssistantId.delete(assistantMessage.id);

      const after = get();
      const sid = String(queueSessionId ?? "").trim();
      if (!sid) return;
      if (isSessionStreaming(after, sid)) return;
      const idx = after.pendingMessages.findIndex((message) => message.sessionId.trim() === sid);
      if (idx < 0) return;
      const next = after.pendingMessages[idx];
      if (!next) return;
      set((prev) => ({
        pendingMessages: prev.pendingMessages.filter((_, index) => index !== idx),
      }));
      queueMicrotask(() => {
        void get().sendMessage(client, {
          content: next.content,
          attachments: next.attachments,
          webSearch: get().lastWebSearchBySessionId[next.sessionId],
          deepResearch: get().lastDeepResearchBySessionId[next.sessionId],
        });
      });
    }
  },

  async editUserMessageAndResend(client, input) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    if (isSessionStreaming(state, sessionId)) return;

    const nextContent = input.content.trim();
    if (!nextContent) return;

    const sessionMessages = getSessionMessages(state.messages, sessionId);
    const sessionUserIds = new Set(sessionMessages.filter((message) => message.role === "user").map((message) => message.id));
    const { userIndex, assistantIndex } = findUserAndAssistantIndex(sessionMessages, input.messageId);
    if (userIndex < 0) return;

    const tenantId = input.tenantId ?? state.sessions.find((session) => session.id === sessionId)?.tenant_id ?? DEFAULT_TENANT;
    const userId = input.userId ?? state.sessions.find((session) => session.id === sessionId)?.user_id ?? DEFAULT_USER;
    const sourceUserMessage = sessionMessages[userIndex];
    const sourceAssistantMessage = assistantIndex >= 0 ? sessionMessages[assistantIndex] : undefined;
    if (!sourceUserMessage || sourceUserMessage.role !== "user") return;

    const createdAtPair = pairedCreatedAt();
    const replacementAssistant: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      created_at: createdAtPair.assistant,
    };

    const editedMessages = [...sessionMessages];
    editedMessages[userIndex] = {
      ...sourceUserMessage,
      content: nextContent,
      created_at: createdAtPair.user,
    };

    let targetAssistantIndex = assistantIndex;
    if (targetAssistantIndex >= 0) {
      editedMessages[targetAssistantIndex] = replacementAssistant;
    } else {
      targetAssistantIndex = userIndex + 1;
      editedMessages.splice(targetAssistantIndex, 0, replacementAssistant);
    }

    const truncatedSessionMessages = editedMessages.slice(0, targetAssistantIndex + 1);
    const userIdsInScope = new Set(
      truncatedSessionMessages.filter((message) => message.role === "user").map((message) => message.id)
    );

    const previousVersionState = state.responseVersionsByUserMessageId[input.messageId];
    const previousVersions =
      previousVersionState?.versions ??
      (sourceAssistantMessage
        ? [toAssistantVersion(sourceAssistantMessage, { queryVersionIndex: 0, retryAttempt: 0, queryText: sourceUserMessage.content })]
        : []);
    const previousQueryIndices = getSortedQueryVersionIndices(previousVersions);
    const nextQueryVersionIndex =
      previousQueryIndices.length > 0 ? Math.max(...previousQueryIndices) + 1 : 0;
    const nextVersions = [
      ...previousVersions,
      toAssistantVersion(replacementAssistant, { queryVersionIndex: nextQueryVersionIndex, retryAttempt: 0, queryText: nextContent }),
    ];
    const nextActiveIndex = Math.max(0, nextVersions.length - 1);
    const previousActiveAssistantIndexByQueryVersion =
      previousVersionState?.activeAssistantIndexByQueryVersion ??
      { 0: Math.max(0, previousVersions.length - 1) };
    const nextActiveAssistantIndexByQueryVersion = {
      ...previousActiveAssistantIndexByQueryVersion,
      [nextQueryVersionIndex]: nextActiveIndex,
    };

    set((prev) => ({
      messages: mergeSessionMessages(prev.messages, sessionId, truncatedSessionMessages),
      errorMessage: null,
      responseVersionsByUserMessageId: {
        ...Object.fromEntries(
          Object.entries(prev.responseVersionsByUserMessageId).filter(
            ([userMessageId]) => !sessionUserIds.has(userMessageId) || userIdsInScope.has(userMessageId)
          )
        ),
        [input.messageId]: {
          versions: nextVersions,
          activeIndex: nextActiveIndex,
          activeAssistantIndexByQueryVersion: nextActiveAssistantIndexByQueryVersion,
        },
      },
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              message_count: truncatedSessionMessages.length,
              updated_at: now(),
              last_message_at: now(),
            }
          : session
      ),
    }));
    const sendingId = makeId();
    let ownedRequestId = sendingId;
    const editDeepResearch = Boolean(state.lastDeepResearchBySessionId[sessionId]);
    setSessionStream(set, sessionId, {
      status: "sending",
      activeRequestId: sendingId,
      assistantMessageId: replacementAssistant.id,
    });
    const streamWriter = editDeepResearch
      ? null
      : createAssistantStreamWriter(
          set,
          get,
          sessionId,
          replacementAssistant.id,
          input.messageId,
          () => getSessionRequestId(get(), sessionId) === ownedRequestId,
        );
    let streamCancelled = false;
    let streamFinishReason: string | undefined;

    try {
      const request = toSdkRequest(
        sessionId,
        state.activeModel,
        truncatedSessionMessages,
        Boolean(state.lastWebSearchBySessionId[sessionId]),
        Boolean(state.lastDeepResearchBySessionId[sessionId]),
        getDeepResearchInteractionPref(),
        get().lastSkillIdBySessionId[sessionId],
      );
      const { requestId, traceId } = await client.sendMessage(request);
      if (getSessionRequestId(get(), sessionId) !== sendingId) {
        await client.cancel(requestId);
        return;
      }
      ownedRequestId = requestId;
      setSessionStream(set, sessionId, {
        status: "streaming",
        activeRequestId: requestId,
        assistantMessageId: replacementAssistant.id,
      });
      // trace_id 是跨服务关联键（requestId 只是前端内存句柄，不出浏览器）。
      // 挂到助手消息上，供气泡「复制请求 ID」与落库后的排障检索。
      if (traceId) {
        set((prev) => ({
          messages: prev.messages.map((message) =>
            message.id === replacementAssistant.id ? { ...message, trace_id: traceId } : message,
          ),
        }));
      }

      for await (const chunk of client.stream(requestId)) {
        if (getSessionRequestId(get(), sessionId) !== ownedRequestId) return;
        const finishReason = readFinishReason(chunk);
        if (finishReason) streamFinishReason = finishReason;
        if (!chunk.delta || chunk.error || chunk.cancelled || chunk.done) streamWriter?.flush();
        if (chunk.cancelled) {
          streamCancelled = true;
          if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
            setSessionStream(set, sessionId, null);
            set((prev) => (prev.activeSessionId === sessionId ? { errorMessage: null } : {}));
          }
          break;
        }

        if (chunk.error) {
          const settled = streamErrorNotice(chunk.error, chunk.traceId);
          appendStreamErrorToAssistant(set, replacementAssistant.id, input.messageId, settled.notice, settled.reason);
          setSessionStream(set, sessionId, null);
          set((prev) =>
            prev.activeSessionId === sessionId
              ? { status: "error" as const, errorMessage: settled.notice }
              : {},
          );
          return;
        }

        if (chunk.delta) {
          probeNote("stream.delta", {
            sessionId,
            assistantId: replacementAssistant.id,
            n: chunk.delta.length,
            via: "edit",
          });
          if (streamWriter) {
            streamWriter.push(chunk.delta);
          } else set((prev) => {
            const versionState = prev.responseVersionsByUserMessageId[input.messageId];
            const nextVersionState = versionState
              ? {
                  ...versionState,
                  versions: versionState.versions.map((version, index) =>
                    index === versionState.activeIndex ? { ...version, content: `${version.content}${chunk.delta}` } : version
                  ),
                }
              : versionState;
            return {
              messages: prev.messages.map((message) =>
                message.id === replacementAssistant.id ? { ...message, content: `${message.content}${chunk.delta}` } : message
              ),
              responseVersionsByUserMessageId: versionState
                ? {
                    ...prev.responseVersionsByUserMessageId,
                    [input.messageId]: nextVersionState as UserResponseVersionState,
                  }
                : prev.responseVersionsByUserMessageId,
            };
          });
        }

        if (chunk.usage) {
          set((prev) => {
            const nextTokens = addChunkToSessionTokens(prev.sessionTokens, chunk.usage ?? {});
            const prevForSession = prev.sessionTokensBySessionId[sessionId] ?? { ...EMPTY_USAGE };
            const nextForSession = addChunkToSessionTokens(prevForSession, chunk.usage ?? {});
            return {
              sessionTokens: nextTokens,
              sessionTokensBySessionId: {
                ...prev.sessionTokensBySessionId,
                [sessionId]: nextForSession,
              },
            };
          });
        }

        if (chunk.webSearchSources?.length) {
          applyWebSearchSourcesToAssistant(
            set,
            replacementAssistant.id,
            input.messageId,
            chunk.webSearchSources,
          );
        }

        if (chunk.deepResearchEvent) {
          applyDeepResearchEventToAssistant(
            set,
            replacementAssistant.id,
            input.messageId,
            chunk.deepResearchEvent,
          );
        }

        if (chunk.done) {
          streamWriter?.flush();
          if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
            setSessionStream(set, sessionId, null);
          }
        }
      }

      streamWriter?.flush();
      settleOrdinaryTerminal(
        set,
        get,
        sessionId,
        replacementAssistant.id,
        input.messageId,
        editDeepResearch,
        streamCancelled,
        streamFinishReason,
      );

      const afterEdit = get();
      const editedAssistant = afterEdit.messages.find((message) => message.id === replacementAssistant.id);
      if ((afterEdit.status !== "error" || editedAssistant?.interruption) && afterEdit.hydrated) {
        const snapshot = getSessionMessages(afterEdit.messages, sessionId);
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await portalHistory.replaceMessages(sessionId, snapshot);
          setSessionHistorySync(set, sessionId, null);
        } catch (persistErr) {
          // P0: replace_all is not durable-retried (needs history_revision + CAS).
          setSessionHistorySync(set, sessionId, {
            pendingCount: 0,
            state: "dead_letter",
            message: "编辑结果未保存，请重试",
          });
          void persistErr;
        }
      }
    } catch (error) {
      try {
        streamWriter?.flush();
      } catch {
        // Keep the turn error below.
      }
      if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
        const streamErrorMessage = toStreamCatchErrorMessage(error);
        appendStreamErrorToAssistant(set, replacementAssistant.id, input.messageId, streamErrorMessage, "failed");
        setSessionStream(set, sessionId, null);
        set((prev) =>
          prev.activeSessionId === sessionId
            ? { status: "error" as const, errorMessage: streamErrorMessage }
            : {},
        );
      }
    } finally {
      streamWriter?.stop();
    }
  },

  async continueResponse(client, assistantMessageId) {
    const state = get();
    const source = state.messages.find(
      (message) => message.id === assistantMessageId && message.session_id === state.activeSessionId,
    );
    if (!source || source.role !== "assistant" || source.deep_research) return;
    if (isSessionStreaming(state, source.session_id)) return;
    if (findContinuableResponse(state.messages, state.activeSessionId)?.id !== source.id) return;
    await get().regenerateAssistantResponse(client, assistantMessageId, { continue: true });
  },

  async attachReportContinuation(sessionId, runId) {
    const state = get();
    if (!sessionId || !runId || isSessionStreaming(state, sessionId)) return;
    const source = state.messages.find(
      (message) =>
        message.session_id === sessionId &&
        message.role === "assistant" &&
        message.deep_research?.runId === runId,
    );
    if (!source?.deep_research) {
      if (state.activeSessionId === sessionId) {
        set({ errorMessage: "找不到可继续的研究报告。" });
      }
      return;
    }
    const pendingId = makeId();
    setSessionStream(set, sessionId, {
      status: "sending",
      activeRequestId: pendingId,
      assistantMessageId: source.id,
    });
    try {
      const response = await fetch("/api/chat/deep-research/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { runId?: unknown; traceId?: unknown };
        error?: { message?: unknown };
      } | null;
      if (!response.ok || typeof body?.data?.runId !== "string") {
        const message = typeof body?.error?.message === "string"
          ? body.error.message
          : "暂时无法继续完成报告，请稍后重试。";
        throw new Error(message);
      }
      if (getSessionRequestId(get(), sessionId) !== pendingId) return;
      const nextRunId = body.data.runId;
      const traceId = typeof body.data.traceId === "string" ? body.data.traceId.trim() : "";
      const stamp = new Date().toISOString();
      const scope = {
        session_id: sessionId,
        tenant_id: source.tenant_id,
        user_id: source.user_id,
      };
      const userMessage: ChatMessage = {
        ...scope,
        id: makeId(),
        role: "user",
        content: "继续完成报告",
        control: "continue_report",
        created_at: stamp,
      };
      const assistantMessage: ChatMessage = {
        ...scope,
        id: makeId(),
        role: "assistant",
        content: "",
        created_at: stamp,
        ...(source.model ? { model: source.model } : {}),
        ...(traceId ? { trace_id: traceId } : {}),
        deep_research: { runId: nextRunId, status: "running", events: [] },
      };
      set((prev) => ({ messages: [...prev.messages, userMessage, assistantMessage] }));
      if (get().hydrated) void persistAppendMessages(set, sessionId, [userMessage, assistantMessage]);
      const hydrated = await fetchLatestDeepResearchForHydrate(sessionId, fetch, nextRunId);
      if (hydrated?.events?.length) {
        const knownStatus = hydrated.status;
        const status =
          knownStatus === "failed" ||
          knownStatus === "cancelled" ||
          knownStatus === "completed" ||
          knownStatus === "awaiting_clarify" ||
          knownStatus === "running"
            ? knownStatus
            : "running";
        set((prev) => ({
          messages: prev.messages.map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  deep_research: {
                    runId: nextRunId,
                    status,
                    events: hydrated.events,
                    ...(hydrated.artifactIds?.length ? { artifactIds: hydrated.artifactIds } : {}),
                  },
                }
              : message,
          ),
        }));
      }
      setSessionStream(set, sessionId, {
        status: "streaming",
        activeRequestId: pendingId,
        assistantMessageId: assistantMessage.id,
      });
      const savedEvents = get().messages.find((message) => message.id === assistantMessage.id)?.deep_research?.events ?? [];
      await startDeepResearchReconnect(nextRunId, {
        savedEvents,
        onEvent: (event) => {
          applyDeepResearchEventToAssistant(set, assistantMessage.id, userMessage.id, event);
        },
        onDelta: (text) => {
          set((prev) => ({
            messages: prev.messages.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: `${message.content ?? ""}${text}` }
                : message,
            ),
          }));
        },
        onDone: () => {
          const latest = get().messages.find((message) => message.id === assistantMessage.id);
          if (latest && get().hydrated) void persistAppendMessages(set, sessionId, [latest]);
        },
      });
    } catch (error) {
      if (get().activeSessionId === sessionId) {
        set({
          errorMessage: error instanceof Error ? error.message : "暂时无法继续完成报告，请稍后重试。",
        });
      }
    } finally {
      if (getSessionRequestId(get(), sessionId) === pendingId) {
        setSessionStream(set, sessionId, null);
      }
    }
  },

  async regenerateAssistantResponse(client, assistantMessageId, mode) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    if (isSessionStreaming(state, sessionId)) return;

    const sessionMessages = getSessionMessages(state.messages, sessionId);
    const { assistantIndex, userIndex } = findAssistantAndRelatedUserIndex(sessionMessages, assistantMessageId);
    if (assistantIndex < 0 || userIndex < 0) return;

    const sourceAssistantMessage = sessionMessages[assistantIndex];
    const sourceUserMessage = sessionMessages[userIndex];
    if (!sourceAssistantMessage || sourceAssistantMessage.role !== "assistant") return;
    if (!sourceUserMessage || sourceUserMessage.role !== "user") return;

    const tenantId = sourceAssistantMessage.tenant_id ?? sourceUserMessage.tenant_id ?? DEFAULT_TENANT;
    const userId = sourceAssistantMessage.user_id ?? sourceUserMessage.user_id ?? DEFAULT_USER;
    const targetUserMessageId = sourceUserMessage.id;
    const continuing = mode?.continue === true;
    const rawPrefix = continuing
      ? sourceAssistantMessage.content.slice(0, sourceAssistantMessage.interruption?.contentLength ?? sourceAssistantMessage.content.length)
      : "";
    const { retainedContent: prefix, requestContent: answerPrefix } = prepareAssistantContinuation(rawPrefix);
    const ordinaryContinuation = continuing && !sourceAssistantMessage.deep_research;
    const deepResearchEnabled = !ordinaryContinuation && Boolean(state.lastDeepResearchBySessionId[sessionId]);

    const replacementAssistant: ChatMessage = {
      ...(continuing ? sourceAssistantMessage : {}),
      id: continuing ? sourceAssistantMessage.id : makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: prefix,
      interruption: undefined,
      model: continuing ? sourceAssistantMessage.model ?? state.activeModel : state.activeModel,
      // Keep assistant after the related user even if both were previously same-ms stamped.
      created_at: continuing
        ? sourceAssistantMessage.created_at
        : pairedCreatedAt(Math.max(Date.parse(sourceUserMessage.created_at) || Date.now(), Date.now())).assistant,
      ...(deepResearchEnabled
        ? {
            deep_research: {
              runId: "pending",
              status: "running" as const,
              events: [],
              artifactIds: [],
            },
          }
        : continuing
          ? { deep_research: undefined }
          : {}),
    };

    const nextSessionMessages = [...sessionMessages];
    nextSessionMessages[assistantIndex] = replacementAssistant;

    const previousVersionState = state.responseVersionsByUserMessageId[targetUserMessageId];
    const previousVersions =
      previousVersionState?.versions ??
      [toAssistantVersion(sourceAssistantMessage, { queryVersionIndex: 0, retryAttempt: 0, queryText: sourceUserMessage.content })];
    const fallbackActiveIndex = findVersionIndexByAssistantId(previousVersions, sourceAssistantMessage.id);
    const currentVersionIndex = previousVersionState?.activeIndex ?? (fallbackActiveIndex >= 0 ? fallbackActiveIndex : 0);
    const currentVersion = previousVersions[currentVersionIndex] ?? previousVersions[previousVersions.length - 1];
    const currentQueryVersionIndex = currentVersion?.queryVersionIndex ?? 0;
    const queryVersionIndices = getIndicesForQueryVersion(previousVersions, currentQueryVersionIndex);
    const currentMaxRetryAttempt = Math.max(
      ...queryVersionIndices.map((index) => previousVersions[index]?.retryAttempt ?? 0),
      0,
    );
    const continuationVersion = toAssistantVersion(replacementAssistant, {
      queryVersionIndex: currentQueryVersionIndex,
      retryAttempt: currentVersion?.retryAttempt ?? 0,
      queryText: currentVersion?.queryText ?? sourceUserMessage.content,
    });
    const nextVersions = continuing
      ? previousVersions.map((version, index) => (index === currentVersionIndex ? continuationVersion : version))
      : [
          ...previousVersions,
          toAssistantVersion(replacementAssistant, {
            queryVersionIndex: currentQueryVersionIndex,
            retryAttempt: currentMaxRetryAttempt + 1,
            queryText: currentVersion?.queryText ?? sourceUserMessage.content,
          }),
        ];
    const nextActiveIndex = continuing ? currentVersionIndex : Math.max(0, nextVersions.length - 1);
    const nextActiveAssistantIndexByQueryVersion = {
      ...(previousVersionState?.activeAssistantIndexByQueryVersion ?? { [currentQueryVersionIndex]: currentVersionIndex }),
      [currentQueryVersionIndex]: nextActiveIndex,
    };

    // 只把目标 query 及其之前上下文发送给模型，避免“重试旧 query”误用后续 query 作为当前提问。
    // Continue sends the visible prefix, never the appended notice or reasoning.
    const regenerateRequestMessages = nextSessionMessages.slice(0, assistantIndex);
    if (!continuing || answerPrefix.trim()) {
      regenerateRequestMessages.push({
        ...replacementAssistant,
        content: continuing ? answerPrefix : replacementAssistant.content,
        reasoning: undefined,
      });
    }
    if (continuing && answerPrefix.trim()) {
      regenerateRequestMessages.push({
        ...sourceUserMessage,
        id: makeId(),
        attachments: undefined,
        content: "继续完成上一条尚未结束的回答。从已有内容的断点继续，只输出后续内容，不要重复、改写或重新生成已完成部分。",
      });
    }

    set((prev) => ({
      messages: mergeSessionMessages(prev.messages, sessionId, nextSessionMessages),
      errorMessage: null,
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [targetUserMessageId]: {
          versions: nextVersions,
          activeIndex: nextActiveIndex,
          activeAssistantIndexByQueryVersion: nextActiveAssistantIndexByQueryVersion,
        },
      },
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updated_at: now(),
              last_message_at: now(),
            }
          : session
      ),
    }));
    const sendingId = makeId();
    let ownedRequestId = sendingId;
    setSessionStream(set, sessionId, {
      status: "sending",
      activeRequestId: sendingId,
      assistantMessageId: replacementAssistant.id,
    });
    const streamWriter = deepResearchEnabled
      ? null
      : createAssistantStreamWriter(
          set,
          get,
          sessionId,
          replacementAssistant.id,
          targetUserMessageId,
          () => getSessionRequestId(get(), sessionId) === ownedRequestId,
        );
    const ordinaryCheckpoint = !deepResearchEnabled
      ? checkpointOrdinaryResponse(
          set,
          get,
          sessionId,
          targetUserMessageId,
          replacementAssistant.id,
          () => getSessionRequestId(get(), sessionId) === ownedRequestId,
        )
      : null;
    let streamCancelled = false;
    let streamFinishReason: string | undefined;

    try {
      const request = toSdkRequest(
        sessionId,
        continuing ? replacementAssistant.model ?? state.activeModel : state.activeModel,
        regenerateRequestMessages,
        Boolean(state.lastWebSearchBySessionId[sessionId]),
        deepResearchEnabled,
        getDeepResearchInteractionPref(),
        get().lastSkillIdBySessionId[sessionId],
      );
      const { requestId, traceId } = await client.sendMessage(request);
      if (getSessionRequestId(get(), sessionId) !== sendingId) {
        await client.cancel(requestId);
        return;
      }
      ownedRequestId = requestId;
      setSessionStream(set, sessionId, {
        status: "streaming",
        activeRequestId: requestId,
        assistantMessageId: replacementAssistant.id,
      });
      // trace_id 是跨服务关联键（requestId 只是前端内存句柄，不出浏览器）。
      // 挂到助手消息上，供气泡「复制请求 ID」与落库后的排障检索。
      if (traceId) {
        set((prev) => ({
          messages: prev.messages.map((message) =>
            message.id === replacementAssistant.id ? { ...message, trace_id: traceId } : message,
          ),
        }));
      }

      for await (const chunk of client.stream(requestId)) {
        if (getSessionRequestId(get(), sessionId) !== ownedRequestId) return;
        const finishReason = readFinishReason(chunk);
        if (finishReason) streamFinishReason = finishReason;
        if (!chunk.delta || chunk.error || chunk.cancelled || chunk.done) streamWriter?.flush();
        if (chunk.cancelled) {
          streamCancelled = true;
          if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
            setSessionStream(set, sessionId, null);
            set((prev) => (prev.activeSessionId === sessionId ? { errorMessage: null } : {}));
          }
          break;
        }

        if (chunk.error) {
          const settled = streamErrorNotice(chunk.error, chunk.traceId);
          appendStreamErrorToAssistant(
            set,
            replacementAssistant.id,
            targetUserMessageId,
            settled.notice,
            settled.reason,
          );
          setSessionStream(set, sessionId, null);
          set((prev) =>
            prev.activeSessionId === sessionId
              ? { status: "error" as const, errorMessage: settled.notice }
              : {},
          );
          return;
        }

        if (chunk.delta) {
          probeNote("stream.delta", {
            sessionId,
            assistantId: replacementAssistant.id,
            n: chunk.delta.length,
            via: "regenerate",
          });
          if (streamWriter) {
            streamWriter.push(chunk.delta);
          } else set((prev) => {
            const versionState = prev.responseVersionsByUserMessageId[targetUserMessageId];
            const nextVersionState = versionState
              ? {
                  ...versionState,
                  versions: versionState.versions.map((version, index) =>
                    index === versionState.activeIndex ? { ...version, content: `${version.content}${chunk.delta}` } : version
                  ),
                }
              : versionState;
            return {
              messages: prev.messages.map((message) =>
                message.id === replacementAssistant.id ? { ...message, content: `${message.content}${chunk.delta}` } : message
              ),
              responseVersionsByUserMessageId: versionState
                ? {
                    ...prev.responseVersionsByUserMessageId,
                    [targetUserMessageId]: nextVersionState as UserResponseVersionState,
                  }
                : prev.responseVersionsByUserMessageId,
            };
          });
          ordinaryCheckpoint?.changed();
        }

        if (chunk.usage) {
          set((prev) => {
            const nextTokens = addChunkToSessionTokens(prev.sessionTokens, chunk.usage ?? {});
            const prevForSession = prev.sessionTokensBySessionId[sessionId] ?? { ...EMPTY_USAGE };
            const nextForSession = addChunkToSessionTokens(prevForSession, chunk.usage ?? {});
            return {
              sessionTokens: nextTokens,
              sessionTokensBySessionId: {
                ...prev.sessionTokensBySessionId,
                [sessionId]: nextForSession,
              },
            };
          });
        }

        if (chunk.webSearchSources?.length) {
          applyWebSearchSourcesToAssistant(
            set,
            replacementAssistant.id,
            targetUserMessageId,
            chunk.webSearchSources,
          );
        }

        if (chunk.deepResearchEvent) {
          applyDeepResearchEventToAssistant(
            set,
            replacementAssistant.id,
            targetUserMessageId,
            chunk.deepResearchEvent,
          );
        }

        if (chunk.done) {
          streamWriter?.flush();
          if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
            setSessionStream(set, sessionId, null);
          }
        }
      }

      streamWriter?.flush();
      settleOrdinaryTerminal(
        set,
        get,
        sessionId,
        replacementAssistant.id,
        targetUserMessageId,
        deepResearchEnabled,
        streamCancelled,
        streamFinishReason,
      );

      const afterRegen = get();
      const regeneratedAssistant = afterRegen.messages.find((message) => message.id === replacementAssistant.id);
      if (!continuing && (afterRegen.status !== "error" || regeneratedAssistant?.interruption) && afterRegen.hydrated) {
        const snapshot = getSessionMessages(afterRegen.messages, sessionId);
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await portalHistory.replaceMessages(sessionId, snapshot);
          setSessionHistorySync(set, sessionId, null);
        } catch (persistErr) {
          // P0: replace_all is not durable-retried (needs history_revision + CAS).
          setSessionHistorySync(set, sessionId, {
            pendingCount: 0,
            state: "dead_letter",
            message: "编辑结果未保存，请重试",
          });
          void persistErr;
        }
      }
    } catch (error) {
      try {
        streamWriter?.flush();
      } catch {
        // Keep the turn error below.
      }
      if (getSessionRequestId(get(), sessionId) === ownedRequestId) {
        const streamErrorMessage = toStreamCatchErrorMessage(error);
        appendStreamErrorToAssistant(
          set,
          replacementAssistant.id,
          targetUserMessageId,
          streamErrorMessage,
          "failed",
        );
        setSessionStream(set, sessionId, null);
        set((prev) =>
          prev.activeSessionId === sessionId
            ? { status: "error" as const, errorMessage: streamErrorMessage }
            : {},
        );
      }
    } finally {
      streamWriter?.stop();
      ordinaryCheckpoint?.stop();
      if (continuing) {
        const latest = get();
        const active = getSessionRequestId(latest, sessionId);
        const assistant = latest.messages.find((message) => message.id === replacementAssistant.id);
        if (
          latest.hydrated &&
          assistant &&
          assistant.interruption?.reason !== "cancelled" &&
          (!active || active === ownedRequestId)
        ) {
          await persistAppendMessages(set, sessionId, [assistant]);
        }
      }
    }
  },

  showPreviousResponseVersion(userMessageId) {
    set((state) => {
      const versionState = state.responseVersionsByUserMessageId[userMessageId];
      if (!versionState || versionState.versions.length === 0) return state;
      const { userIndex, assistantIndex } = findUserAndAssistantIndex(state.messages, userMessageId);
      if (assistantIndex < 0 || userIndex < 0) return state;

      const activeVersion = versionState.versions[versionState.activeIndex];
      const activeQueryVersionIndex = activeVersion?.queryVersionIndex ?? 0;
      const activeAssistantMap = versionState.activeAssistantIndexByQueryVersion ?? {};
      const queryVersionIndices = getSortedQueryVersionIndices(versionState.versions);
      const activeQueryPosition = queryVersionIndices.indexOf(activeQueryVersionIndex);
      if (activeQueryPosition <= 0) return state;
      const targetQueryVersionIndex = queryVersionIndices[activeQueryPosition - 1];
      if (typeof targetQueryVersionIndex !== "number") return state;
      const maybeTargetIndex =
        activeAssistantMap[targetQueryVersionIndex] ??
        (() => {
          const indices = getIndicesForQueryVersion(versionState.versions, targetQueryVersionIndex);
          return indices.length > 0 ? indices[indices.length - 1] : -1;
        })();
      if (typeof maybeTargetIndex !== "number" || maybeTargetIndex < 0) return state;
      const targetIndex = maybeTargetIndex;
      const targetVersion = versionState.versions[targetIndex];
      if (!targetVersion) return state;

      return {
        ...state,
        responseVersionsByUserMessageId: {
          ...state.responseVersionsByUserMessageId,
          [userMessageId]: {
            ...versionState,
            activeIndex: targetIndex,
            activeAssistantIndexByQueryVersion: {
              ...activeAssistantMap,
              [targetQueryVersionIndex]: targetIndex,
            },
          },
        },
        messages: state.messages.map((message, index) =>
          index === assistantIndex
            ? {
                ...message,
                content: targetVersion.content,
                web_search_sources: targetVersion.web_search_sources,
                deep_research: targetVersion.deep_research,
                interruption: targetVersion.interruption,
              }
            : index === userIndex
              ? { ...message, content: targetVersion.queryText || message.content }
              : message
        ),
      };
    });
  },

  showNextResponseVersion(userMessageId) {
    set((state) => {
      const versionState = state.responseVersionsByUserMessageId[userMessageId];
      if (!versionState || versionState.versions.length === 0) return state;
      const { userIndex, assistantIndex } = findUserAndAssistantIndex(state.messages, userMessageId);
      if (assistantIndex < 0 || userIndex < 0) return state;

      const activeVersion = versionState.versions[versionState.activeIndex];
      const activeQueryVersionIndex = activeVersion?.queryVersionIndex ?? 0;
      const activeAssistantMap = versionState.activeAssistantIndexByQueryVersion ?? {};
      const queryVersionIndices = getSortedQueryVersionIndices(versionState.versions);
      const activeQueryPosition = queryVersionIndices.indexOf(activeQueryVersionIndex);
      if (activeQueryPosition < 0 || activeQueryPosition >= queryVersionIndices.length - 1) return state;
      const targetQueryVersionIndex = queryVersionIndices[activeQueryPosition + 1];
      if (typeof targetQueryVersionIndex !== "number") return state;
      const maybeTargetIndex =
        activeAssistantMap[targetQueryVersionIndex] ??
        (() => {
          const indices = getIndicesForQueryVersion(versionState.versions, targetQueryVersionIndex);
          return indices.length > 0 ? indices[indices.length - 1] : -1;
        })();
      if (typeof maybeTargetIndex !== "number" || maybeTargetIndex < 0) return state;
      const targetIndex = maybeTargetIndex;
      const targetVersion = versionState.versions[targetIndex];
      if (!targetVersion) return state;

      return {
        ...state,
        responseVersionsByUserMessageId: {
          ...state.responseVersionsByUserMessageId,
          [userMessageId]: {
            ...versionState,
            activeIndex: targetIndex,
            activeAssistantIndexByQueryVersion: {
              ...activeAssistantMap,
              [targetQueryVersionIndex]: targetIndex,
            },
          },
        },
        messages: state.messages.map((message, index) =>
          index === assistantIndex
            ? {
                ...message,
                content: targetVersion.content,
                web_search_sources: targetVersion.web_search_sources,
                deep_research: targetVersion.deep_research,
                interruption: targetVersion.interruption,
              }
            : index === userIndex
              ? { ...message, content: targetVersion.queryText || message.content }
              : message
        ),
      };
    });
  },

  showPreviousRetryVersion(userMessageId) {
    set((state) => {
      const versionState = state.responseVersionsByUserMessageId[userMessageId];
      if (!versionState || versionState.versions.length === 0) return state;
      const { assistantIndex } = findUserAndAssistantIndex(state.messages, userMessageId);
      if (assistantIndex < 0) return state;

      const activeVersion = versionState.versions[versionState.activeIndex];
      const activeQueryVersionIndex = activeVersion?.queryVersionIndex ?? 0;
      const activeAssistantMap = versionState.activeAssistantIndexByQueryVersion ?? {};
      const retryIndices = getIndicesForQueryVersion(versionState.versions, activeQueryVersionIndex);
      const activeRetryPosition = retryIndices.indexOf(versionState.activeIndex);
      if (activeRetryPosition <= 0) return state;
      const targetIndex = retryIndices[activeRetryPosition - 1];
      if (typeof targetIndex !== "number") return state;
      const targetVersion = versionState.versions[targetIndex];
      if (!targetVersion) return state;

      return {
        ...state,
        responseVersionsByUserMessageId: {
          ...state.responseVersionsByUserMessageId,
          [userMessageId]: {
            ...versionState,
            activeIndex: targetIndex,
            activeAssistantIndexByQueryVersion: {
              ...activeAssistantMap,
              [activeQueryVersionIndex]: targetIndex,
            },
          },
        },
        messages: state.messages.map((message, index) =>
          index === assistantIndex
            ? {
                ...message,
                content: targetVersion.content,
                web_search_sources: targetVersion.web_search_sources,
                deep_research: targetVersion.deep_research,
                interruption: targetVersion.interruption,
              }
            : message
        ),
      };
    });
  },

  showNextRetryVersion(userMessageId) {
    set((state) => {
      const versionState = state.responseVersionsByUserMessageId[userMessageId];
      if (!versionState || versionState.versions.length === 0) return state;
      const { assistantIndex } = findUserAndAssistantIndex(state.messages, userMessageId);
      if (assistantIndex < 0) return state;

      const activeVersion = versionState.versions[versionState.activeIndex];
      const activeQueryVersionIndex = activeVersion?.queryVersionIndex ?? 0;
      const activeAssistantMap = versionState.activeAssistantIndexByQueryVersion ?? {};
      const retryIndices = getIndicesForQueryVersion(versionState.versions, activeQueryVersionIndex);
      const activeRetryPosition = retryIndices.indexOf(versionState.activeIndex);
      if (activeRetryPosition < 0 || activeRetryPosition >= retryIndices.length - 1) return state;
      const targetIndex = retryIndices[activeRetryPosition + 1];
      if (typeof targetIndex !== "number") return state;
      const targetVersion = versionState.versions[targetIndex];
      if (!targetVersion) return state;

      return {
        ...state,
        responseVersionsByUserMessageId: {
          ...state.responseVersionsByUserMessageId,
          [userMessageId]: {
            ...versionState,
            activeIndex: targetIndex,
            activeAssistantIndexByQueryVersion: {
              ...activeAssistantMap,
              [activeQueryVersionIndex]: targetIndex,
            },
          },
        },
        messages: state.messages.map((message, index) =>
          index === assistantIndex
            ? {
                ...message,
                content: targetVersion.content,
                web_search_sources: targetVersion.web_search_sources,
                deep_research: targetVersion.deep_research,
                interruption: targetVersion.interruption,
              }
            : message
        ),
      };
    });
  },

  async cancel(client) {
    let state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId || cancellingSessions.has(sessionId)) return;
    try {
      streamTextBySession.get(sessionId)?.stop();
    } catch {
      // A rendering failure must not prevent server cancellation.
    }
    streamTextBySession.delete(sessionId);
    state = get();
    const requestId = getSessionRequestId(state, sessionId);
    if (!requestId) return;
    const streamAssistantId = state.streamStateBySessionId[sessionId]?.assistantMessageId;
    const latestAssistant =
      state.messages.find((message) => message.id === streamAssistantId && message.role === "assistant") ??
      [...state.messages].reverse().find((message) => message.session_id === sessionId && message.role === "assistant");
    if (latestAssistant?.deep_research) {
      const runId = latestAssistant.deep_research.runId?.trim();
      if (runId && runId !== "pending") {
        await fetch("/api/chat/deep-research/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ runId }),
        }).catch(() => undefined);
      }
      await client.cancel(requestId);
      return;
    }
    cancellingSessions.add(sessionId);
    const stoppingId = makeId();
    try {
      setSessionStream(set, sessionId, {
        status: "streaming",
        activeRequestId: stoppingId,
        assistantMessageId: latestAssistant?.id,
      });
      if (latestAssistant) {
        responseCheckpoints.get(latestAssistant.id)?.stop();
        responseCheckpoints.delete(latestAssistant.id);
        const interruption = latestAssistant.interruption ?? {
          reason: "cancelled" as const,
          contentLength: latestAssistant.content.length,
        };
        set((prev) => ({
          messages: prev.messages.map((message) =>
            message.id === latestAssistant.id ? { ...message, interruption } : message,
          ),
          responseVersionsByUserMessageId: Object.fromEntries(
            Object.entries(prev.responseVersionsByUserMessageId).map(([id, versionState]) => [
              id,
              {
                ...versionState,
                versions: versionState.versions.map((version) =>
                  version.id === latestAssistant.id ? { ...version, interruption } : version,
                ),
              },
            ]),
          ),
        }));
      }
      await client.cancel(requestId);
      const stopped = get().messages.find((message) => message.id === latestAssistant?.id);
      if (stopped && get().hydrated) {
        const sessionMessages = getSessionMessages(get().messages, sessionId);
        const index = sessionMessages.findIndex((message) => message.id === stopped.id);
        const user = index > 0 && sessionMessages[index - 1]?.role === "user" ? sessionMessages[index - 1] : undefined;
        await persistAppendMessages(set, sessionId, user ? [user, stopped] : [stopped]);
      }
      if (getSessionRequestId(get(), sessionId) === stoppingId) {
        setSessionStream(set, sessionId, null);
        set((prev) => (prev.activeSessionId === sessionId ? { errorMessage: null } : {}));
      }
    } catch {
      set((prev) =>
        prev.activeSessionId === sessionId
          ? { errorMessage: "终止未确认，请重试；后台任务可能仍在运行。" }
          : {},
      );
    } finally {
      cancellingSessions.delete(sessionId);
    }
  },

  deleteMessage(messageId) {
    set((state) => {
      const filteredMessages = state.messages.filter((message) => message.id !== messageId);
      const existing = state.responseVersionsByUserMessageId[messageId];
      if (!existing) {
        return {
          messages: filteredMessages,
        };
      }
      const nextVersionMap = { ...state.responseVersionsByUserMessageId };
      delete nextVersionMap[messageId];
      return {
        messages: filteredMessages,
        responseVersionsByUserMessageId: nextVersionMap,
      };
    });
  },

  setDeepResearchClarifyAnswers(assistantMessageId, answers) {
    set((prev) => {
      const nextMessages = prev.messages.map((message) => {
        if (message.id !== assistantMessageId || !message.deep_research) return message;
        return {
          ...message,
          deep_research: {
            ...message.deep_research,
            clarifyAnswers: answers,
            status:
              message.deep_research.status === "awaiting_clarify"
                ? "running"
                : message.deep_research.status,
          },
        };
      });
      return { messages: nextMessages };
    });
  },
}));


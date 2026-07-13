import { create } from "zustand";
import { ulid as newUlid } from "ulid";
import {
  buildAutoTitleFromFirstUserMessage,
  sessionTitleNeedsAutoFill,
  toComplianceMessage,
  type ChatMessage,
  type ChatSession,
} from "@agenticx/core-api";
import type { ChatClient, ChatRequest as SdkChatRequest } from "@agenticx/sdk-ts";
import { ChatHistoryHttpError, createPortalChatHistoryClient } from "./history-client";
import type { QueuedMessage } from "./types/queued-message";
import { shouldEnqueueOnResend } from "./utils/message-queue";
import { getSessionRequestId, isSessionStreaming } from "./utils/session-stream-state";

export type ChatStatus = "idle" | "sending" | "streaming" | "error";

export type SessionStreamState = {
  status: "sending" | "streaming";
  activeRequestId: string;
};

type SendMessageInput = {
  content: string;
  attachments?: import("@agenticx/core-api").ChatMessageAttachment[];
  tenantId?: string;
  userId?: string;
};

type SendMessageOptions = {
  /** Interrupt current stream and send immediately (queue send-now / double Enter). */
  forceSend?: boolean;
};

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
  historyError: string | null;
  sessionMessagesLoading: boolean;
  /** 本地草稿 session：用户发送首条消息前不落盘（对齐 Machi Desktop lazy create） */
  draftSessionId: string | null;
  /** 流式生成中排队等待发送的消息（按 session 隔离） */
  pendingMessages: QueuedMessage[];
  /** 当前正在 sending/streaming 的会话，供侧栏状态指示（切换会话后仍指向原 session） */
  streamingSessionId: string | null;
  /** 按 session 隔离的流式状态，支持多 session 并发 */
  streamStateBySessionId: Record<string, SessionStreamState>;
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
  bootstrap(params?: { tenantId?: string; userId?: string; defaultModel?: string; title?: string }): void;
  createSession(params?: { tenantId?: string; userId?: string; defaultModel?: string; title?: string }): Promise<void>;
  switchSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  switchModel(model: string): void;
  sendMessage(client: ChatClient, input: SendMessageInput, options?: SendMessageOptions): Promise<void>;
  sendQueuedMessageNow(client: ChatClient, messageId: string): Promise<void>;
  removePendingMessage(messageId: string): void;
  editPendingMessage(messageId: string, content: string): void;
  editUserMessageAndResend(client: ChatClient, input: EditUserMessageInput): Promise<void>;
  regenerateAssistantResponse(client: ChatClient, assistantMessageId: string): Promise<void>;
  showPreviousResponseVersion(userMessageId: string): void;
  showNextResponseVersion(userMessageId: string): void;
  showPreviousRetryVersion(userMessageId: string): void;
  showNextRetryVersion(userMessageId: string): void;
  cancel(client: ChatClient): Promise<void>;
  deleteMessage(messageId: string): void;
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

function toSdkRequest(sessionId: string, model: string, messages: ChatMessage[]): SdkChatRequest {
  return {
    sessionId,
    model,
    stream: true,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role === "tool" ? "assistant" : message.role,
      content: message.content,
      attachments: message.attachments?.map((item) => ({
        name: item.name,
        mimeType: item.mime_type,
        size: item.size,
        dataUrl: item.data_url,
      })),
      createdAt: message.created_at,
    })),
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
  };
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
let sessionMessageLoadSeq = 0;
let historyAuthRedirectScheduled = false;
const portalHistory = createPortalChatHistoryClient();

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

  return error instanceof Error ? error.message : fallback;
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
  historyError: null,
  sessionMessagesLoading: false,
  draftSessionId: null,
  pendingMessages: [],
  streamingSessionId: null,
  streamStateBySessionId: {},

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

  async sendQueuedMessageNow(client, messageId) {
    const item = get().pendingMessages.find((message) => message.id === messageId);
    if (!item) return;
    set((state) => ({
      pendingMessages: state.pendingMessages.filter((message) => message.id !== messageId),
    }));
    await get().sendMessage(
      client,
      { content: item.content, attachments: item.attachments },
      { forceSend: true }
    );
  },

  async hydrateSessions() {
    if (chatHydrateInFlight) {
      await chatHydrateInFlight;
      return;
    }
    if (get().hydrated) return;

    chatHydrateInFlight = (async () => {
      set({ historyLoading: true, historyError: null });
      try {
        const sessions = await portalHistory.listSessions();
        if (sessions.length === 0) {
          set({
            ...beginDraftSessionPatch(get()),
            sessions: [],
            hydrated: true,
            historyLoading: false,
            historyError: null,
          });
          historyAuthRedirectScheduled = false;
          return;
        }
        const activeSession = sessions[0]!;
        const activeSessionId = activeSession.id;
        const remoteMessages = await portalHistory.getMessages(activeSessionId);
        const responseVersions = buildHydratedResponseVersions(remoteMessages);

        set({
          sessions,
          activeSessionId,
          draftSessionId: null,
          messages: remoteMessages,
          hydrated: true,
          historyLoading: false,
          historyError: null,
          activeModel: activeSession.active_model ?? get().activeModel ?? DEFAULT_MODEL,
          status: "idle",
          activeRequestId: null,
          errorMessage: null,
          sessionTokens: { ...EMPTY_USAGE },
          sessionTokensBySessionId: { [activeSessionId]: { ...EMPTY_USAGE } },
          responseVersionsByUserMessageId: responseVersions,
        });
        historyAuthRedirectScheduled = false;
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

  bootstrap(params) {
    if (get().hydrated) return;
    set({
      ...beginDraftSessionPatch(get(), params),
      sessions: [],
      hydrated: false,
    });
  },

  async createSession(params) {
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
      const responseVersions = buildHydratedResponseVersions(remoteMessages);
      if (loadSeq !== sessionMessageLoadSeq || get().activeSessionId !== sessionId) return;
      set((state) => ({
        messages: mergeSessionMessages(state.messages, sessionId, remoteMessages),
        responseVersionsByUserMessageId: {
          ...stripVersionsForSession(state, sessionId),
          ...responseVersions,
        },
        sessionMessagesLoading: false,
      }));
    } catch (error) {
      if (loadSeq !== sessionMessageLoadSeq || get().activeSessionId !== sessionId) return;
      set({
        sessionMessagesLoading: false,
        historyError: error instanceof Error ? error.message : "加载消息失败",
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
      set({ historyError: error instanceof Error ? error.message : "重命名失败" });
    }
  },

  async deleteSession(sessionId) {
    if (isDraftSessionId(get(), sessionId)) return;

    if (get().hydrated) {
      try {
        await portalHistory.deleteSession(sessionId);
      } catch (error) {
        set({ historyError: error instanceof Error ? error.message : "删除失败" });
        return;
      }
    }

    const willBeEmpty = get().sessions.filter((s) => s.id !== sessionId).length === 0;

    set((state) => {
      const removedUserIds = new Set(
        state.messages
          .filter((message) => message.session_id === sessionId && message.role === "user")
          .map((message) => message.id),
      );
      const nextMessages = state.messages.filter((message) => message.session_id !== sessionId);
      const nextSessions = state.sessions.filter((session) => session.id !== sessionId);
      const nextTokensMap = { ...state.sessionTokensBySessionId };
      delete nextTokensMap[sessionId];
      const nextVersions = { ...state.responseVersionsByUserMessageId };
      for (const id of removedUserIds) {
        delete nextVersions[id];
      }
      let nextActive = state.activeSessionId;
      if (nextActive === sessionId) {
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
    const sessionId = get().activeSessionId;
    if (isDraftSessionId(get(), sessionId)) {
      set({ activeModel: model });
      return;
    }
    set((state) => ({
      activeModel: model,
      sessions: state.sessions.map((session) =>
        session.id === state.activeSessionId
          ? {
              ...session,
              active_model: model,
              updated_at: now(),
            }
          : session
      ),
    }));
    if (get().hydrated && sessionId) {
      void portalHistory.patchSession(sessionId, { activeModel: model }).catch((error) => {
        set({ historyError: error instanceof Error ? error.message : "更新模型失败" });
      });
    }
  },

  async sendMessage(client, input, options) {
    const state = get();
    let sessionId = state.activeSessionId;
    if (!sessionId) return;

    const content = input.content.trim();
    const attachments = input.attachments?.filter((item) => item.data_url?.trim()) ?? [];
    if (!content && attachments.length === 0) return;

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
      return;
    }

    if (options?.forceSend && isSessionStreaming(get(), sessionId)) {
      await get().cancel(client);
    }

    let queueSessionId = sessionId;
    if (isDraftSessionId(get(), sessionId)) {
        if (state.hydrated) {
          try {
            const created = await portalHistory.createSession({
              title: buildAutoTitleFromFirstUserMessage(content) || "New chat",
              activeModel: state.activeModel,
            });
            sessionId = created.id;
            set((prev) => {
              const draftId = prev.draftSessionId;
              const draftTokens = draftId ? (prev.sessionTokensBySessionId[draftId] ?? { ...EMPTY_USAGE }) : { ...EMPTY_USAGE };
              const nextTokensMap = { ...prev.sessionTokensBySessionId };
              if (draftId) delete nextTokensMap[draftId];
              nextTokensMap[created.id] = draftTokens;
              return {
                draftSessionId: null,
                activeSessionId: created.id,
                sessions: [...prev.sessions, created],
                sessionTokensBySessionId: nextTokensMap,
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
            active_model: state.activeModel,
            message_count: 0,
            created_at: now(),
            updated_at: now(),
          };
          set((prev) => ({
            draftSessionId: null,
            sessions: [...prev.sessions, promoted],
          }));
        }
      }

    queueSessionId = sessionId;

    const latest = get();
    const tenantId = input.tenantId ?? latest.sessions.find((session) => session.id === sessionId)?.tenant_id ?? DEFAULT_TENANT;
    const userId = input.userId ?? latest.sessions.find((session) => session.id === sessionId)?.user_id ?? DEFAULT_USER;
    const createdAtPair = pairedCreatedAt();
    const userMessage: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      created_at: createdAtPair.user,
    };
    const assistantMessage: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: latest.activeModel,
      created_at: createdAtPair.assistant,
    };

    const sessionMessages = getSessionMessages(latest.messages, sessionId);
    const nextSessionMessages = [...sessionMessages, userMessage, assistantMessage];
    const priorUserCount = sessionMessages.filter((m) => m.role === "user").length;
    const shouldAutoTitle = priorUserCount === 0;

    set((prev) => ({
      messages: mergeSessionMessages(prev.messages, sessionId, nextSessionMessages),
      errorMessage: null,
      responseVersionsByUserMessageId: {
        ...prev.responseVersionsByUserMessageId,
        [userMessage.id]: {
          versions: [toAssistantVersion(assistantMessage, { queryVersionIndex: 0, retryAttempt: 0, queryText: content })],
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
    setSessionStream(set, sessionId, { status: "sending", activeRequestId: "" });

    try {
      const request = toSdkRequest(sessionId, get().activeModel, nextSessionMessages);
      const { requestId } = await client.sendMessage(request);
      setSessionStream(set, sessionId, { status: "streaming", activeRequestId: requestId });

      for await (const chunk of client.stream(requestId)) {
        if (chunk.cancelled) {
          setSessionStream(set, sessionId, null);
          set({ errorMessage: null });
          break;
        }

        if (chunk.error) {
          const complianceMessage = toComplianceMessage(chunk.error.code, chunk.error.message);
          setSessionStream(set, sessionId, null);
          set({ errorMessage: complianceMessage });
          set((prev) => ({
            messages: prev.messages.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: complianceMessage } : message
            ),
          }));
          return;
        }

        if (chunk.delta) {
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

        if (chunk.done) {
          setSessionStream(set, sessionId, null);
        }
      }

      const after = get();
      if (after.status !== "error" && after.hydrated) {
        const u = after.messages.find((m) => m.id === userMessage.id);
        const a = after.messages.find((m) => m.id === assistantMessage.id);
        if (u && a && u.role === "user" && a.role === "assistant") {
          try {
            await portalHistory.appendMessages(sessionId, [u, a]);
          } catch (persistErr) {
            set({
              historyError: persistErr instanceof Error ? persistErr.message : "保存消息失败",
            });
          }
        }
      }
    } catch (error) {
      setSessionStream(set, sessionId, null);
      set((prev) =>
        prev.activeSessionId === sessionId
          ? {
              status: "error" as const,
              errorMessage: error instanceof Error ? error.message : "Unknown send error",
            }
          : {},
      );
    } finally {
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
        void get().sendMessage(client, { content: next.content, attachments: next.attachments });
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
    setSessionStream(set, sessionId, { status: "sending", activeRequestId: "" });

    try {
      const request = toSdkRequest(sessionId, state.activeModel, truncatedSessionMessages);
      const { requestId } = await client.sendMessage(request);
      setSessionStream(set, sessionId, { status: "streaming", activeRequestId: requestId });

      for await (const chunk of client.stream(requestId)) {
        if (chunk.cancelled) {
          setSessionStream(set, sessionId, null);
          set({ errorMessage: null });
          break;
        }

        if (chunk.error) {
          const complianceMessage = toComplianceMessage(chunk.error.code, chunk.error.message);
          setSessionStream(set, sessionId, null);
          set({ errorMessage: complianceMessage });
          set((prev) => ({
            messages: prev.messages.map((message) =>
              message.id === replacementAssistant.id ? { ...message, content: complianceMessage } : message
            ),
          }));
          return;
        }

        if (chunk.delta) {
          set((prev) => {
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

        if (chunk.done) {
          setSessionStream(set, sessionId, null);
        }
      }

      const afterEdit = get();
      if (afterEdit.status !== "error" && afterEdit.hydrated) {
        const snapshot = getSessionMessages(afterEdit.messages, sessionId);
        try {
          await portalHistory.replaceMessages(sessionId, snapshot);
        } catch (persistErr) {
          set({
            historyError: persistErr instanceof Error ? persistErr.message : "保存消息失败",
          });
        }
      }
    } catch (error) {
      setSessionStream(set, sessionId, null);
      set((prev) =>
        prev.activeSessionId === sessionId
          ? {
              status: "error" as const,
              errorMessage: error instanceof Error ? error.message : "Unknown send error",
            }
          : {},
      );
    }
  },

  async regenerateAssistantResponse(client, assistantMessageId) {
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

    const replacementAssistant: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      // Keep assistant after the related user even if both were previously same-ms stamped.
      created_at: pairedCreatedAt(Math.max(Date.parse(sourceUserMessage.created_at) || Date.now(), Date.now())).assistant,
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
    const nextVersions = [
      ...previousVersions,
      toAssistantVersion(replacementAssistant, {
        queryVersionIndex: currentQueryVersionIndex,
        retryAttempt: currentMaxRetryAttempt + 1,
        queryText: currentVersion?.queryText ?? sourceUserMessage.content,
      }),
    ];
    const nextActiveIndex = Math.max(0, nextVersions.length - 1);
    const nextActiveAssistantIndexByQueryVersion = {
      ...(previousVersionState?.activeAssistantIndexByQueryVersion ?? { [currentQueryVersionIndex]: currentVersionIndex }),
      [currentQueryVersionIndex]: nextActiveIndex,
    };

    // 只把目标 query 及其之前上下文发送给模型，避免“重试旧 query”误用后续 query 作为当前提问。
    const regenerateRequestMessages = nextSessionMessages.slice(0, assistantIndex + 1);

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
    setSessionStream(set, sessionId, { status: "sending", activeRequestId: "" });

    try {
      const request = toSdkRequest(sessionId, state.activeModel, regenerateRequestMessages);
      const { requestId } = await client.sendMessage(request);
      setSessionStream(set, sessionId, { status: "streaming", activeRequestId: requestId });

      for await (const chunk of client.stream(requestId)) {
        if (chunk.cancelled) {
          setSessionStream(set, sessionId, null);
          set({ errorMessage: null });
          break;
        }

        if (chunk.error) {
          const complianceMessage = toComplianceMessage(chunk.error.code, chunk.error.message);
          setSessionStream(set, sessionId, null);
          set({ errorMessage: complianceMessage });
          set((prev) => ({
            messages: prev.messages.map((message) =>
              message.id === replacementAssistant.id ? { ...message, content: complianceMessage } : message
            ),
          }));
          return;
        }

        if (chunk.delta) {
          set((prev) => {
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

        if (chunk.done) {
          setSessionStream(set, sessionId, null);
        }
      }

      const afterRegen = get();
      if (afterRegen.status !== "error" && afterRegen.hydrated) {
        const snapshot = getSessionMessages(afterRegen.messages, sessionId);
        try {
          await portalHistory.replaceMessages(sessionId, snapshot);
        } catch (persistErr) {
          set({
            historyError: persistErr instanceof Error ? persistErr.message : "保存消息失败",
          });
        }
      }
    } catch (error) {
      setSessionStream(set, sessionId, null);
      set((prev) =>
        prev.activeSessionId === sessionId
          ? {
              status: "error" as const,
              errorMessage: error instanceof Error ? error.message : "Unknown send error",
            }
          : {},
      );
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
            ? { ...message, content: targetVersion.content }
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
            ? { ...message, content: targetVersion.content }
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
          index === assistantIndex ? { ...message, content: targetVersion.content } : message
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
          index === assistantIndex ? { ...message, content: targetVersion.content } : message
        ),
      };
    });
  },

  async cancel(client) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    const requestId = getSessionRequestId(state, sessionId);
    if (!requestId) return;
    await client.cancel(requestId);
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
}));


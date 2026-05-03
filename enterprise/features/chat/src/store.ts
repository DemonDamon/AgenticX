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
import { createPortalChatHistoryClient } from "./history-client";

export type ChatStatus = "idle" | "sending" | "streaming" | "error";

type SendMessageInput = {
  content: string;
  tenantId?: string;
  userId?: string;
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
  sendMessage(client: ChatClient, input: SendMessageInput): Promise<void>;
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

function toSdkRequest(sessionId: string, model: string, messages: ChatMessage[]): SdkChatRequest {
  return {
    sessionId,
    model,
    stream: true,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role === "tool" ? "assistant" : message.role,
      content: message.content,
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
const portalHistory = createPortalChatHistoryClient();

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

  async hydrateSessions() {
    if (chatHydrateInFlight) {
      await chatHydrateInFlight;
      return;
    }
    if (get().hydrated) return;

    chatHydrateInFlight = (async () => {
      set({ historyLoading: true, historyError: null });
      try {
        let sessions = await portalHistory.listSessions();
        if (sessions.length === 0) {
          const state = get();
          const welcome = await portalHistory.createSession({
            title: "欢迎使用 AgenticX",
            activeModel: state.activeModel !== DEFAULT_MODEL ? state.activeModel : undefined,
          });
          sessions = [welcome];
        }
        const activeSession = sessions[0]!;
        const activeSessionId = activeSession.id;
        const remoteMessages = await portalHistory.getMessages(activeSessionId);
        const responseVersions = buildHydratedResponseVersions(remoteMessages);

        set({
          sessions,
          activeSessionId,
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
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载历史失败";
        set({
          historyLoading: false,
          historyError: message,
          hydrated: false,
        });
      } finally {
        chatHydrateInFlight = null;
      }
    })();

    await chatHydrateInFlight;
  },

  bootstrap(params) {
    if (get().hydrated) return;
    const sessionId = makeId();
    const session: ChatSession = {
      id: sessionId,
      tenant_id: params?.tenantId ?? DEFAULT_TENANT,
      user_id: params?.userId ?? DEFAULT_USER,
      title: params?.title?.trim() || "New chat",
      active_model: params?.defaultModel ?? DEFAULT_MODEL,
      message_count: 0,
      created_at: now(),
      updated_at: now(),
    };

    set({
      sessions: [session],
      activeSessionId: sessionId,
      messages: [],
      status: "idle",
      activeModel: session.active_model ?? DEFAULT_MODEL,
      errorMessage: null,
      activeRequestId: null,
      sessionTokens: { ...EMPTY_USAGE },
      sessionTokensBySessionId: { [sessionId]: { ...EMPTY_USAGE } },
      responseVersionsByUserMessageId: {},
    });
  },

  async createSession(params) {
    if (!get().hydrated) {
      const sessionId = makeId();
      const session: ChatSession = {
        id: sessionId,
        tenant_id: params?.tenantId ?? DEFAULT_TENANT,
        user_id: params?.userId ?? DEFAULT_USER,
        title: params?.title?.trim() || "New chat",
        active_model: params?.defaultModel ?? get().activeModel ?? DEFAULT_MODEL,
        message_count: 0,
        created_at: now(),
        updated_at: now(),
      };

      set((prev) => ({
        sessions: [...prev.sessions, session],
        activeSessionId: sessionId,
        activeModel: session.active_model ?? DEFAULT_MODEL,
        status: "idle",
        errorMessage: null,
        activeRequestId: null,
        sessionTokens: { ...EMPTY_USAGE },
        sessionTokensBySessionId: {
          ...prev.sessionTokensBySessionId,
          [sessionId]: { ...EMPTY_USAGE },
        },
      }));
      return;
    }

    try {
      const created = await portalHistory.createSession({
        title: params?.title?.trim() || "New chat",
        activeModel: params?.defaultModel ?? get().activeModel,
      });
      set((prev) => ({
        sessions: [...prev.sessions, created],
        activeSessionId: created.id,
        activeModel: created.active_model ?? prev.activeModel ?? DEFAULT_MODEL,
        status: "idle",
        errorMessage: null,
        activeRequestId: null,
        sessionTokens: { ...EMPTY_USAGE },
        sessionTokensBySessionId: {
          ...prev.sessionTokensBySessionId,
          [created.id]: { ...EMPTY_USAGE },
        },
        messages: mergeSessionMessages(prev.messages, created.id, []),
        responseVersionsByUserMessageId: {},
      }));
    } catch (error) {
      set({ historyError: error instanceof Error ? error.message : "创建会话失败" });
    }
  },

  async switchSession(sessionId) {
    const target = get().sessions.find((session) => session.id === sessionId);
    if (!target) return;
    const tokens = get().sessionTokensBySessionId[sessionId] ?? { ...EMPTY_USAGE };
    if (!get().hydrated) {
      set({
        activeSessionId: sessionId,
        activeModel: target.active_model ?? DEFAULT_MODEL,
        errorMessage: null,
        sessionTokens: { ...tokens },
      });
      return;
    }

    const previousActiveId = get().activeSessionId;
    set({
      activeSessionId: sessionId,
      activeModel: target.active_model ?? DEFAULT_MODEL,
      errorMessage: null,
      sessionTokens: { ...tokens },
      sessionMessagesLoading: true,
    });

    try {
      const remoteMessages = await portalHistory.getMessages(sessionId);
      const responseVersions = buildHydratedResponseVersions(remoteMessages);
      set((state) => ({
        messages: mergeSessionMessages(state.messages, sessionId, remoteMessages),
        responseVersionsByUserMessageId: {
          ...stripVersionsForSession(state, sessionId),
          ...responseVersions,
        },
        sessionMessagesLoading: false,
      }));
    } catch (error) {
      set({
        activeSessionId: previousActiveId,
        sessionMessagesLoading: false,
        historyError: error instanceof Error ? error.message : "加载消息失败",
      });
    }
  },

  async renameSession(sessionId, title) {
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

    if (willBeEmpty && get().hydrated) {
      await get().createSession({
        title: "欢迎使用 AgenticX",
        defaultModel: get().activeModel,
      });
    }
  },

  switchModel(model) {
    const sessionId = get().activeSessionId;
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

  async sendMessage(client, input) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    if (state.status === "sending" || state.status === "streaming") return;

    const content = input.content.trim();
    if (!content) return;

    const tenantId = input.tenantId ?? state.sessions.find((session) => session.id === sessionId)?.tenant_id ?? DEFAULT_TENANT;
    const userId = input.userId ?? state.sessions.find((session) => session.id === sessionId)?.user_id ?? DEFAULT_USER;
    const userMessage: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content,
      created_at: now(),
    };
    const assistantMessage: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      created_at: now(),
    };

    const sessionMessages = getSessionMessages(state.messages, sessionId);
    const nextSessionMessages = [...sessionMessages, userMessage, assistantMessage];
    const priorUserCount = sessionMessages.filter((m) => m.role === "user").length;
    const shouldAutoTitle = priorUserCount === 0;

    set((prev) => ({
      messages: mergeSessionMessages(prev.messages, sessionId, nextSessionMessages),
      status: "sending",
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

    try {
      const request = toSdkRequest(sessionId, state.activeModel, nextSessionMessages);
      const { requestId } = await client.sendMessage(request);
      set({ status: "streaming", activeRequestId: requestId });

      for await (const chunk of client.stream(requestId)) {
        if (chunk.error) {
          set({
            status: "error",
            errorMessage: toComplianceMessage(chunk.error.code, chunk.error.message),
            activeRequestId: null,
          });
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
          set({ status: "idle", activeRequestId: null });
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
      set({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown send error",
        activeRequestId: null,
      });
    }
  },

  async editUserMessageAndResend(client, input) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    if (state.status === "sending" || state.status === "streaming") return;

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

    const replacementAssistant: ChatMessage = {
      id: makeId(),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      created_at: now(),
    };

    const editedMessages = [...sessionMessages];
    editedMessages[userIndex] = {
      ...sourceUserMessage,
      content: nextContent,
      created_at: now(),
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
      status: "sending",
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

    try {
      const request = toSdkRequest(sessionId, state.activeModel, truncatedSessionMessages);
      const { requestId } = await client.sendMessage(request);
      set({ status: "streaming", activeRequestId: requestId });

      for await (const chunk of client.stream(requestId)) {
        if (chunk.error) {
          set({
            status: "error",
            errorMessage: toComplianceMessage(chunk.error.code, chunk.error.message),
            activeRequestId: null,
          });
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
          set({ status: "idle", activeRequestId: null });
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
      set({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown send error",
        activeRequestId: null,
      });
    }
  },

  async regenerateAssistantResponse(client, assistantMessageId) {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    if (state.status === "sending" || state.status === "streaming") return;

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
      created_at: now(),
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
      status: "sending",
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

    try {
      const request = toSdkRequest(sessionId, state.activeModel, regenerateRequestMessages);
      const { requestId } = await client.sendMessage(request);
      set({ status: "streaming", activeRequestId: requestId });

      for await (const chunk of client.stream(requestId)) {
        if (chunk.error) {
          set({
            status: "error",
            errorMessage: toComplianceMessage(chunk.error.code, chunk.error.message),
            activeRequestId: null,
          });
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
          set({ status: "idle", activeRequestId: null });
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
      set({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown send error",
        activeRequestId: null,
      });
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
    const requestId = get().activeRequestId;
    if (!requestId) return;
    await client.cancel(requestId);
    set({ status: "idle", activeRequestId: null });
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


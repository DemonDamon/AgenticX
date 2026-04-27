import { create } from "zustand";
import { toComplianceMessage, type ChatMessage, type ChatSession } from "@agenticx/core-api";
import type { ChatClient, ChatRequest as SdkChatRequest } from "@agenticx/sdk-ts";

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
  responseVersionsByUserMessageId: Record<string, UserResponseVersionState>;
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
  bootstrap(params?: { tenantId?: string; userId?: string; defaultModel?: string }): void;
  switchSession(sessionId: string): void;
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

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
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

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  status: "idle",
  activeModel: DEFAULT_MODEL,
  activeRequestId: null,
  errorMessage: null,
  sessionTokens: { ...EMPTY_USAGE },
  responseVersionsByUserMessageId: {},

  bootstrap(params) {
    const sessionId = makeId("session");
    const session: ChatSession = {
      id: sessionId,
      tenant_id: params?.tenantId ?? DEFAULT_TENANT,
      user_id: params?.userId ?? DEFAULT_USER,
      title: "New chat",
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
      responseVersionsByUserMessageId: {},
    });
  },

  switchSession(sessionId) {
    const target = get().sessions.find((session) => session.id === sessionId);
    if (!target) return;
    set({
      activeSessionId: sessionId,
      activeModel: target.active_model ?? DEFAULT_MODEL,
      errorMessage: null,
    });
  },

  switchModel(model) {
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
      id: makeId("msg_user"),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content,
      created_at: now(),
    };
    const assistantMessage: ChatMessage = {
      id: makeId("msg_assistant"),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      created_at: now(),
    };

    const nextMessages = [...state.messages, userMessage, assistantMessage];

    set((prev) => ({
      messages: nextMessages,
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
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              message_count: session.message_count + 2,
              last_message_at: now(),
              updated_at: now(),
            }
          : session
      ),
    }));

    try {
      const request = toSdkRequest(sessionId, state.activeModel, nextMessages);
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
          set((prev) => ({
            sessionTokens: {
              inputTokens: prev.sessionTokens.inputTokens + (chunk.usage?.inputTokens ?? 0),
              outputTokens: prev.sessionTokens.outputTokens + (chunk.usage?.outputTokens ?? 0),
              totalTokens: prev.sessionTokens.totalTokens + (chunk.usage?.totalTokens ?? 0),
              lastInputTokens: chunk.usage?.inputTokens ?? 0,
              lastOutputTokens: chunk.usage?.outputTokens ?? 0,
              lastUpdatedAt: now(),
            },
          }));
        }

        if (chunk.done) {
          set({ status: "idle", activeRequestId: null });
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

    const { userIndex, assistantIndex } = findUserAndAssistantIndex(state.messages, input.messageId);
    if (userIndex < 0) return;

    const tenantId = input.tenantId ?? state.sessions.find((session) => session.id === sessionId)?.tenant_id ?? DEFAULT_TENANT;
    const userId = input.userId ?? state.sessions.find((session) => session.id === sessionId)?.user_id ?? DEFAULT_USER;
    const sourceUserMessage = state.messages[userIndex];
    const sourceAssistantMessage = assistantIndex >= 0 ? state.messages[assistantIndex] : undefined;
    if (!sourceUserMessage || sourceUserMessage.role !== "user") return;

    const replacementAssistant: ChatMessage = {
      id: makeId("msg_assistant"),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      created_at: now(),
    };

    const editedMessages = [...state.messages];
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

    const truncatedMessages = editedMessages.slice(0, targetAssistantIndex + 1);
    const userIdsInScope = new Set(
      truncatedMessages.filter((message) => message.role === "user").map((message) => message.id)
    );
    const scopedVersionMap = Object.fromEntries(
      Object.entries(state.responseVersionsByUserMessageId).filter(([userMessageId]) => userIdsInScope.has(userMessageId))
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
      messages: truncatedMessages,
      status: "sending",
      errorMessage: null,
      responseVersionsByUserMessageId: {
        ...Object.fromEntries(
          Object.entries(prev.responseVersionsByUserMessageId).filter(([userMessageId]) => userIdsInScope.has(userMessageId))
        ),
        ...scopedVersionMap,
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
              message_count: truncatedMessages.length,
              updated_at: now(),
              last_message_at: now(),
            }
          : session
      ),
    }));

    try {
      const request = toSdkRequest(sessionId, state.activeModel, truncatedMessages);
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
          set((prev) => ({
            sessionTokens: {
              inputTokens: prev.sessionTokens.inputTokens + (chunk.usage?.inputTokens ?? 0),
              outputTokens: prev.sessionTokens.outputTokens + (chunk.usage?.outputTokens ?? 0),
              totalTokens: prev.sessionTokens.totalTokens + (chunk.usage?.totalTokens ?? 0),
              lastInputTokens: chunk.usage?.inputTokens ?? 0,
              lastOutputTokens: chunk.usage?.outputTokens ?? 0,
              lastUpdatedAt: now(),
            },
          }));
        }

        if (chunk.done) {
          set({ status: "idle", activeRequestId: null });
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

    const { assistantIndex, userIndex } = findAssistantAndRelatedUserIndex(state.messages, assistantMessageId);
    if (assistantIndex < 0 || userIndex < 0) return;

    const sourceAssistantMessage = state.messages[assistantIndex];
    const sourceUserMessage = state.messages[userIndex];
    if (!sourceAssistantMessage || sourceAssistantMessage.role !== "assistant") return;
    if (!sourceUserMessage || sourceUserMessage.role !== "user") return;

    const tenantId = sourceAssistantMessage.tenant_id ?? sourceUserMessage.tenant_id ?? DEFAULT_TENANT;
    const userId = sourceAssistantMessage.user_id ?? sourceUserMessage.user_id ?? DEFAULT_USER;
    const targetUserMessageId = sourceUserMessage.id;

    const replacementAssistant: ChatMessage = {
      id: makeId("msg_assistant"),
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "",
      model: state.activeModel,
      created_at: now(),
    };

    const nextMessages = [...state.messages];
    nextMessages[assistantIndex] = replacementAssistant;

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
    const regenerateRequestMessages = nextMessages.slice(0, assistantIndex + 1);

    set((prev) => ({
      messages: nextMessages,
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
          set((prev) => ({
            sessionTokens: {
              inputTokens: prev.sessionTokens.inputTokens + (chunk.usage?.inputTokens ?? 0),
              outputTokens: prev.sessionTokens.outputTokens + (chunk.usage?.outputTokens ?? 0),
              totalTokens: prev.sessionTokens.totalTokens + (chunk.usage?.totalTokens ?? 0),
              lastInputTokens: chunk.usage?.inputTokens ?? 0,
              lastOutputTokens: chunk.usage?.outputTokens ?? 0,
              lastUpdatedAt: now(),
            },
          }));
        }

        if (chunk.done) {
          set({ status: "idle", activeRequestId: null });
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


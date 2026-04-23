import { create } from "zustand";
import { toComplianceMessage, type ChatMessage, type ChatSession } from "@agenticx/core-api";
import type { ChatClient, ChatRequest as SdkChatRequest } from "@agenticx/sdk-ts";

export type ChatStatus = "idle" | "sending" | "streaming" | "error";

type SendMessageInput = {
  content: string;
  tenantId?: string;
  userId?: string;
};

export type ChatStoreState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  activeModel: string;
  activeRequestId: string | null;
  errorMessage: string | null;
};

export type ChatStoreActions = {
  bootstrap(params?: { tenantId?: string; userId?: string; defaultModel?: string }): void;
  switchSession(sessionId: string): void;
  switchModel(model: string): void;
  sendMessage(client: ChatClient, input: SendMessageInput): Promise<void>;
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

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  status: "idle",
  activeModel: DEFAULT_MODEL,
  activeRequestId: null,
  errorMessage: null,

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
          set((prev) => ({
            messages: prev.messages.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: `${message.content}${chunk.delta}` } : message
            ),
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

  async cancel(client) {
    const requestId = get().activeRequestId;
    if (!requestId) return;
    await client.cancel(requestId);
    set({ status: "idle", activeRequestId: null });
  },

  deleteMessage(messageId) {
    set((state) => ({
      messages: state.messages.filter((message) => message.id !== messageId),
    }));
  },
}));


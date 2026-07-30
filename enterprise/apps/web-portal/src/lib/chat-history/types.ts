import type { AuthUser } from "@agenticx/auth";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";

export type ChatHistoryContext = {
  tenantId: string;
  userId: string;
};

export class ChatHistoryNotFoundError extends Error {
  public constructor(message = "session not found") {
    super(message);
    this.name = "ChatHistoryNotFoundError";
  }
}

export class ChatHistoryConflictError extends Error {
  public constructor(message = "conflict") {
    super(message);
    this.name = "ChatHistoryConflictError";
  }
}

export type AppendChatMessagesOptions = {
  operationId?: string;
  payloadHash?: string;
};

export interface ChatHistoryStore {
  isChatSessionOwned(ctx: ChatHistoryContext, sessionId: string): Promise<boolean>;
  listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]>;
  createChatSession(
    ctx: ChatHistoryContext,
    input: { title: string; activeModel?: string },
  ): Promise<ChatSession>;
  getChatSessionMessages(ctx: ChatHistoryContext, sessionId: string): Promise<ChatMessage[]>;
  appendChatMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
    options?: AppendChatMessagesOptions,
  ): Promise<void>;
  replaceAllChatSessionMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void>;
  patchChatSession(
    ctx: ChatHistoryContext,
    sessionId: string,
    patch: { title?: string; activeModel?: string | null; pinned?: boolean },
  ): Promise<ChatSession>;
  renameChatSession(
    ctx: ChatHistoryContext,
    sessionId: string,
    title: string,
  ): Promise<ChatSession>;
  softDeleteChatSession(ctx: ChatHistoryContext, sessionId: string): Promise<void>;
  softDeleteChatSessions(ctx: ChatHistoryContext, sessionIds: string[]): Promise<number>;
  syncAuthUser(user: AuthUser): Promise<void>;
  resetForTests(): void | Promise<void>;
}

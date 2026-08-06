import type { AuthUser } from "@agenticx/auth";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";
import type { ChatShareSnapshot } from "../chat-share-types";

export type { ChatShareMessage, ChatShareSnapshot } from "../chat-share-types";

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

export class ChatShareValidationError extends Error {
  public constructor(message = "invalid share request") {
    super(message);
    this.name = "ChatShareValidationError";
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
  createChatShareSnapshot(
    ctx: ChatHistoryContext,
    sessionId: string,
    messageIds: string[],
  ): Promise<ChatShareSnapshot>;
  getChatShareSnapshot(token: string, tenantId?: string): Promise<ChatShareSnapshot | null>;
  syncAuthUser(user: AuthUser): Promise<void>;
  resetForTests(): void | Promise<void>;
}

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
  ): Promise<void>;
  replaceAllChatSessionMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void>;
  patchChatSession(
    ctx: ChatHistoryContext,
    sessionId: string,
    patch: { title?: string; activeModel?: string | null },
  ): Promise<ChatSession>;
  renameChatSession(
    ctx: ChatHistoryContext,
    sessionId: string,
    title: string,
  ): Promise<ChatSession>;
  softDeleteChatSession(ctx: ChatHistoryContext, sessionId: string): Promise<void>;
  syncAuthUser(user: AuthUser): Promise<void>;
  resetForTests(): void | Promise<void>;
}

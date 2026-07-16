import type { AuthUser } from "@agenticx/auth";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { mysqlChatHistoryStore } from "./chat-history/mysql";
import { postgresqlChatHistoryStore } from "./chat-history/postgresql";
import {
  ChatHistoryNotFoundError,
  type ChatHistoryContext,
  type ChatHistoryStore,
} from "./chat-history/types";

export { ChatHistoryNotFoundError };
export type { ChatHistoryContext };

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isValidUlid(id: string): boolean {
  return typeof id === "string" && ULID_RE.test(id);
}

function store(): ChatHistoryStore {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql":
      return postgresqlChatHistoryStore;
    case "mysql":
      return mysqlChatHistoryStore;
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function isChatSessionOwned(
  ctx: ChatHistoryContext,
  sessionId: string,
): Promise<boolean> {
  return store().isChatSessionOwned(ctx, sessionId);
}

export function listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]> {
  return store().listChatSessions(ctx);
}

export function createChatSession(
  ctx: ChatHistoryContext,
  input: { title: string; activeModel?: string },
): Promise<ChatSession> {
  return store().createChatSession(ctx, input);
}

export function getChatSessionMessages(
  ctx: ChatHistoryContext,
  sessionId: string,
): Promise<ChatMessage[]> {
  return store().getChatSessionMessages(ctx, sessionId);
}

export function appendChatMessages(
  ctx: ChatHistoryContext,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  return store().appendChatMessages(ctx, sessionId, messages);
}

export function replaceAllChatSessionMessages(
  ctx: ChatHistoryContext,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  return store().replaceAllChatSessionMessages(ctx, sessionId, messages);
}

export function patchChatSession(
  ctx: ChatHistoryContext,
  sessionId: string,
  patch: { title?: string; activeModel?: string | null },
): Promise<ChatSession> {
  return store().patchChatSession(ctx, sessionId, patch);
}

export function renameChatSession(
  ctx: ChatHistoryContext,
  sessionId: string,
  title: string,
): Promise<ChatSession> {
  return store().renameChatSession(ctx, sessionId, title);
}

export function softDeleteChatSession(
  ctx: ChatHistoryContext,
  sessionId: string,
): Promise<void> {
  return store().softDeleteChatSession(ctx, sessionId);
}

export function syncAuthUserToDatabase(user: AuthUser): Promise<void> {
  return store().syncAuthUser(user);
}

/** @deprecated Use syncAuthUserToDatabase. Kept for one compatibility cycle. */
export const syncAuthUserToPostgres = syncAuthUserToDatabase;

/** Test hook: release the active dialect pool. */
export function __resetChatHistoryDbForTests(): void {
  void postgresqlChatHistoryStore.resetForTests();
  void mysqlChatHistoryStore.resetForTests();
}

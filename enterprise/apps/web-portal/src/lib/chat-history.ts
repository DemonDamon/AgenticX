import {
  buildAutoTitleFromFirstUserMessage,
  sessionTitleNeedsAutoFill,
  type ChatMessage,
  type ChatMessageRole,
  type ChatSession,
} from "@agenticx/core-api";
import type { AuthUser } from "@agenticx/auth";
import { chatMessages, chatSessions, users } from "@agenticx/db-schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ulid as newUlid } from "ulid";

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

/** Crockford base32 ULID (26 chars). */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isValidUlid(id: string): boolean {
  return typeof id === "string" && ULID_RE.test(id);
}

declare global {
  var __agenticxPortalChatPgPool: Pool | undefined;
}

function getDatabaseUrl(): string {
  const configured = process.env.DATABASE_URL?.trim();
  const raw =
    configured ||
    (process.env.NODE_ENV !== "production" ? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx" : "");
  if (!raw) throw new Error("DATABASE_URL is not configured");
  if (/sslmode=/i.test(raw)) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}sslmode=disable`;
}

function getPool(): Pool {
  if (!globalThis.__agenticxPortalChatPgPool) {
    globalThis.__agenticxPortalChatPgPool = new Pool({ connectionString: getDatabaseUrl(), max: 5 });
  }
  return globalThis.__agenticxPortalChatPgPool;
}

let dbSingleton: NodePgDatabase<Record<string, never>> | null = null;

function getDb(): NodePgDatabase<Record<string, never>> {
  if (!dbSingleton) {
    dbSingleton = drizzle(getPool());
  }
  return dbSingleton;
}

function mapSessionRow(row: typeof chatSessions.$inferSelect): ChatSession {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    user_id: row.userId,
    title: row.title,
    active_model: row.activeModel ?? undefined,
    message_count: row.messageCount,
    last_message_at: row.lastMessageAt?.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapMessageRow(row: typeof chatMessages.$inferSelect): ChatMessage {
  const role = row.role as ChatMessageRole;
  return {
    id: row.id,
    session_id: row.sessionId,
    tenant_id: row.tenantId,
    user_id: row.userId,
    role,
    content: row.content,
    model: row.model ?? undefined,
    created_at: row.createdAt.toISOString(),
  };
}

const ALLOWED_ROLES: ChatMessageRole[] = ["system", "user", "assistant", "tool"];

function normalizeRole(role: string): ChatMessageRole {
  if (ALLOWED_ROLES.includes(role as ChatMessageRole)) {
    return role as ChatMessageRole;
  }
  throw new Error(`invalid message role: ${role}`);
}

export async function isChatSessionOwned(ctx: ChatHistoryContext, sessionId: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
        isNull(chatSessions.deletedAt)
      )
    )
    .limit(1);
  return row.length > 0;
}

export async function listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
        isNull(chatSessions.deletedAt)
      )
    )
    .orderBy(desc(chatSessions.updatedAt));
  return rows.map(mapSessionRow);
}

export async function createChatSession(
  ctx: ChatHistoryContext,
  input: { title: string; activeModel?: string }
): Promise<ChatSession> {
  const db = getDb();
  const id = newUlid();
  const title = input.title.trim() || "New chat";
  const now = new Date();
  const [row] = await db
    .insert(chatSessions)
    .values({
      id,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      title,
      activeModel: input.activeModel?.trim() || null,
      messageCount: 0,
      lastMessageAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("failed to create session");
  return mapSessionRow(row);
}

export async function getChatSessionMessages(ctx: ChatHistoryContext, sessionId: string): Promise<ChatMessage[]> {
  const db = getDb();
  const owned = await isChatSessionOwned(ctx, sessionId);
  if (!owned) throw new ChatHistoryNotFoundError();

  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.tenantId, ctx.tenantId),
        eq(chatMessages.userId, ctx.userId)
      )
    )
    .orderBy(asc(chatMessages.createdAt));
  return rows.map(mapMessageRow);
}

export async function appendChatMessages(
  ctx: ChatHistoryContext,
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  if (messages.length === 0) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const [sessionRow] = await tx
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.tenantId, ctx.tenantId),
          eq(chatSessions.userId, ctx.userId),
          isNull(chatSessions.deletedAt)
        )
      )
      .limit(1);
    if (!sessionRow) throw new ChatHistoryNotFoundError();

    const nowBucket = new Date();
    const values = messages.map((message) => {
      const role = normalizeRole(message.role);
      const createdAt = message.created_at ? new Date(message.created_at) : nowBucket;
      const messageId = isValidUlid(message.id) ? message.id : newUlid();
      return {
        id: messageId,
        sessionId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role,
        content: message.content,
        model: message.model?.trim() || null,
        status: "complete" as const,
        metadata: null as null,
        createdAt,
        updatedAt: createdAt,
      };
    });

    await tx.insert(chatMessages).values(values);

    const lastAt = values[values.length - 1]?.createdAt ?? nowBucket;
    let nextTitle = sessionRow.title;
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && sessionTitleNeedsAutoFill(sessionRow.title)) {
      const auto = buildAutoTitleFromFirstUserMessage(firstUser.content);
      if (auto) nextTitle = auto;
    }

    await tx
      .update(chatSessions)
      .set({
        title: nextTitle,
        messageCount: sessionRow.messageCount + messages.length,
        lastMessageAt: lastAt,
        updatedAt: nowBucket,
        activeModel: sessionRow.activeModel,
      })
      .where(eq(chatSessions.id, sessionId));
  });
}

export async function replaceAllChatSessionMessages(
  ctx: ChatHistoryContext,
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [sessionRow] = await tx
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.tenantId, ctx.tenantId),
          eq(chatSessions.userId, ctx.userId),
          isNull(chatSessions.deletedAt)
        )
      )
      .limit(1);
    if (!sessionRow) throw new ChatHistoryNotFoundError();

    await tx
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, sessionId),
          eq(chatMessages.tenantId, ctx.tenantId),
          eq(chatMessages.userId, ctx.userId)
        )
      );

    const nowBucket = new Date();
    if (messages.length > 0) {
      const rows = messages.map((message) => {
        const role = normalizeRole(message.role);
        const createdAt = message.created_at ? new Date(message.created_at) : nowBucket;
        const messageId = isValidUlid(message.id) ? message.id : newUlid();
        return {
          id: messageId,
          sessionId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          role,
          content: message.content,
          model: message.model?.trim() || null,
          status: "complete" as const,
          metadata: null as null,
          createdAt,
          updatedAt: createdAt,
        };
      });
      await tx.insert(chatMessages).values(rows);
    }

    const lastAt =
      messages.length > 0
        ? (messages[messages.length - 1]?.created_at
            ? new Date(messages[messages.length - 1]!.created_at)
            : nowBucket)
        : null;
    let nextTitle = sessionRow.title;
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && sessionTitleNeedsAutoFill(sessionRow.title)) {
      const auto = buildAutoTitleFromFirstUserMessage(firstUser.content);
      if (auto) nextTitle = auto;
    }

    await tx
      .update(chatSessions)
      .set({
        title: nextTitle,
        messageCount: messages.length,
        lastMessageAt: lastAt,
        updatedAt: nowBucket,
      })
      .where(eq(chatSessions.id, sessionId));
  });
}

export async function patchChatSession(
  ctx: ChatHistoryContext,
  sessionId: string,
  patch: { title?: string; activeModel?: string | null }
): Promise<ChatSession> {
  const db = getDb();
  const updates: {
    title?: string;
    activeModel?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    updates.title = patch.title.trim() || "New chat";
  }
  if (patch.activeModel !== undefined) {
    const v = patch.activeModel;
    updates.activeModel = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  if (patch.title === undefined && patch.activeModel === undefined) {
    throw new Error("patch must include title or active_model");
  }
  const [row] = await db
    .update(chatSessions)
    .set(updates)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
        isNull(chatSessions.deletedAt)
      )
    )
    .returning();
  if (!row) throw new ChatHistoryNotFoundError();
  return mapSessionRow(row);
}

export async function renameChatSession(
  ctx: ChatHistoryContext,
  sessionId: string,
  title: string
): Promise<ChatSession> {
  const db = getDb();
  const nextTitle = title.trim() || "New chat";
  const [row] = await db
    .update(chatSessions)
    .set({
      title: nextTitle,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
        isNull(chatSessions.deletedAt)
      )
    )
    .returning();
  if (!row) throw new ChatHistoryNotFoundError();
  return mapSessionRow(row);
}

export async function softDeleteChatSession(ctx: ChatHistoryContext, sessionId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  const result = await db
    .update(chatSessions)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
        isNull(chatSessions.deletedAt)
      )
    )
    .returning({ id: chatSessions.id });
  if (result.length === 0) throw new ChatHistoryNotFoundError();
}

/**
 * Mirror in-memory auth users into Postgres so chat_sessions FK (user_id, tenant_id) → users exists.
 */
export async function syncAuthUserToPostgres(user: AuthUser): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return;
  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({
      id: user.id,
      tenantId: user.tenantId,
      deptId: user.deptId ?? null,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      status: user.status,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email.toLowerCase(),
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        deptId: user.deptId ?? null,
        status: user.status,
        updatedAt: now,
      },
    });
}

/** Test hook: reset pool (do not use in route handlers). */
export function __resetChatHistoryDbForTests(): void {
  dbSingleton = null;
  void globalThis.__agenticxPortalChatPgPool?.end().catch(() => undefined);
  globalThis.__agenticxPortalChatPgPool = undefined;
}

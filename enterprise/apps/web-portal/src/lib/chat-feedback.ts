import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  chatMessageFeedback as pgFeedbackTable,
  chatMessages as pgMessageTable,
  chatSessions as pgSessionTable,
} from "@agenticx/db-schema";
import {
  chatMessageFeedback as mysqlFeedbackTable,
  chatMessages as mysqlMessageTable,
  chatSessions as mysqlSessionTable,
} from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { ulid } from "ulid";

export const CHAT_FEEDBACK_VALUES = ["like", "dislike"] as const;
export type ChatFeedbackValue = (typeof CHAT_FEEDBACK_VALUES)[number];

export type ChatFeedbackActor = {
  tenantId: string;
  userId: string;
  departmentId?: string | null;
};

export type ChatFeedbackCounts = {
  like: number;
  dislike: number;
  total: number;
};

export type ChatFeedbackRecord = {
  id: string;
  messageId: string;
  sessionId: string;
  value: ChatFeedbackValue;
  model: string | null;
  provider: string | null;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatFeedbackView = {
  messageId: string;
  sessionId: string;
  value: ChatFeedbackValue | null;
  counts: ChatFeedbackCounts;
};

export class ChatFeedbackValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ChatFeedbackValidationError";
  }
}

/** Do not reveal whether a message exists in another user's session/tenant. */
export class ChatFeedbackTargetNotFoundError extends Error {
  public readonly status = 404;
  public constructor() {
    super("assistant message not found");
    this.name = "ChatFeedbackTargetNotFoundError";
  }
}

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const MAX_ID_CHARS = 64;
const MAX_PROVIDER_CHARS = 128;

type FeedbackDb = {
  dialect: "postgresql" | "mysql";
  db: any;
  feedback: any;
  messages: any;
  sessions: any;
};

function id(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ID_CHARS || !ULID_RE.test(normalized)) {
    throw new ChatFeedbackValidationError(`invalid ${field}`);
  }
  return normalized;
}

function optionalSnapshot(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxChars) : null;
}

function normalizeValue(value: unknown): ChatFeedbackValue {
  if (value === "like" || value === "dislike") return value;
  throw new ChatFeedbackValidationError("value must be like or dislike");
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function providerFromMessage(model: unknown, metadataValue: unknown): string | null {
  const metadata = parseMetadata(metadataValue);
  const metadataProvider = optionalSnapshot(metadata.provider ?? metadata.provider_id, MAX_PROVIDER_CHARS);
  if (metadataProvider) return metadataProvider;

  // The routed model is normally provider/model. This is only a server-side
  // derivation from the persisted message, never a client-supplied label.
  const modelValue = optionalSnapshot(model, 160);
  const slash = modelValue?.indexOf("/") ?? -1;
  return slash > 0 ? modelValue!.slice(0, slash) : null;
}

function traceFromMessage(metadataValue: unknown): string | null {
  const metadata = parseMetadata(metadataValue);
  return optionalSnapshot(metadata.trace_id ?? metadata.traceId, 128);
}

async function getFeedbackDb(): Promise<FeedbackDb> {
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const db = (await createMysqlDb(config)).raw;
    return {
      dialect: "mysql",
      db,
      feedback: mysqlFeedbackTable,
      messages: mysqlMessageTable,
      sessions: mysqlSessionTable,
    };
  }
  return {
    dialect: "postgresql",
    db: getIamDb(),
    feedback: pgFeedbackTable,
    messages: pgMessageTable,
    sessions: pgSessionTable,
  };
}

function actorIds(actor: ChatFeedbackActor): { tenantId: string; userId: string } {
  const tenantId = id(actor.tenantId, "tenant_id");
  const userId = id(actor.userId, "user_id");
  return { tenantId, userId };
}

async function ownedAssistantMessage(
  store: FeedbackDb,
  actor: ChatFeedbackActor,
  sessionIdInput: string,
  messageIdInput: string,
): Promise<Record<string, unknown>> {
  const { tenantId, userId } = actorIds(actor);
  const sessionId = id(sessionIdInput, "session_id");
  const messageId = id(messageIdInput, "message_id");
  const rows = await store.db
    .select({
      id: store.messages.id,
      sessionId: store.messages.sessionId,
      tenantId: store.messages.tenantId,
      userId: store.messages.userId,
      role: store.messages.role,
      status: store.messages.status,
      model: store.messages.model,
      metadata: store.messages.metadata,
    })
    .from(store.messages)
    .where(
      and(
        eq(store.messages.id, messageId),
        eq(store.messages.sessionId, sessionId),
        eq(store.messages.tenantId, tenantId),
        eq(store.messages.userId, userId),
        eq(store.messages.role, "assistant"),
        eq(store.messages.status, "complete"),
      ),
    )
    .limit(1);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row || row.role !== "assistant" || row.status !== "complete") {
    throw new ChatFeedbackTargetNotFoundError();
  }
  return row;
}

async function assertOwnedSession(
  store: FeedbackDb,
  actor: ChatFeedbackActor,
  sessionIdInput: string,
): Promise<string> {
  const { tenantId, userId } = actorIds(actor);
  const sessionId = id(sessionIdInput, "session_id");
  const rows = await store.db
    .select({ id: store.sessions.id })
    .from(store.sessions)
    .where(
      and(
        eq(store.sessions.id, sessionId),
        eq(store.sessions.tenantId, tenantId),
        eq(store.sessions.userId, userId),
        isNull(store.sessions.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length > 0) return sessionId;
  throw new ChatFeedbackTargetNotFoundError();
}

function mapRecord(row: Record<string, unknown>): ChatFeedbackRecord {
  const value = normalizeValue(row.value);
  const asIso = (input: unknown): string =>
    input instanceof Date ? input.toISOString() : new Date(String(input)).toISOString();
  return {
    id: String(row.id),
    messageId: String(row.messageId ?? row.message_id),
    sessionId: String(row.sessionId ?? row.session_id),
    value,
    model: row.model == null ? null : String(row.model),
    provider: row.provider == null ? null : String(row.provider),
    traceId: row.traceId == null && row.trace_id == null
      ? null
      : String(row.traceId ?? row.trace_id),
    createdAt: asIso(row.createdAt ?? row.created_at),
    updatedAt: asIso(row.updatedAt ?? row.updated_at),
  };
}

async function countsForMessage(
  store: FeedbackDb,
  tenantId: string,
  messageId: string,
): Promise<ChatFeedbackCounts> {
  const rows = await store.db
    .select({ value: store.feedback.value, count: sql<number>`count(*)` })
    .from(store.feedback)
    .where(and(eq(store.feedback.tenantId, tenantId), eq(store.feedback.messageId, messageId)))
    .groupBy(store.feedback.value);
  let like = 0;
  let dislike = 0;
  for (const row of rows as Array<{ value: unknown; count: unknown }>) {
    const count = Number(row.count ?? 0);
    if (row.value === "like") like = count;
    if (row.value === "dislike") dislike = count;
  }
  return { like, dislike, total: like + dislike };
}

async function currentForMessage(
  store: FeedbackDb,
  actor: ChatFeedbackActor,
  messageId: string,
): Promise<ChatFeedbackRecord | null> {
  const { tenantId, userId } = actorIds(actor);
  const rows = await store.db
    .select()
    .from(store.feedback)
    .where(
      and(
        eq(store.feedback.tenantId, tenantId),
        eq(store.feedback.userId, userId),
        eq(store.feedback.messageId, messageId),
      ),
    )
    .limit(1);
  return rows[0] ? mapRecord(rows[0] as Record<string, unknown>) : null;
}

function viewFor(
  record: ChatFeedbackRecord | null,
  counts: ChatFeedbackCounts,
  messageId: string,
  sessionId: string,
): ChatFeedbackView {
  return {
    messageId,
    sessionId,
    value: record?.value ?? null,
    counts,
  };
}

/** Create/switch the current user's vote; no client identity is accepted. */
export async function upsertChatMessageFeedback(input: {
  actor: ChatFeedbackActor;
  sessionId: string;
  messageId: string;
  value: ChatFeedbackValue;
}): Promise<{ feedback: ChatFeedbackRecord; view: ChatFeedbackView }> {
  const store = await getFeedbackDb();
  const { tenantId, userId } = actorIds(input.actor);
  const sessionId = id(input.sessionId, "session_id");
  const messageId = id(input.messageId, "message_id");
  const value = normalizeValue(input.value);
  const message = await ownedAssistantMessage(store, input.actor, sessionId, messageId);
  const now = new Date();
  const model = optionalSnapshot(message.model, 160);
  const provider = providerFromMessage(message.model, message.metadata);
  const traceId = traceFromMessage(message.metadata);
  const departmentId = optionalSnapshot(input.actor.departmentId, MAX_ID_CHARS);
  const values = {
    id: ulid(),
    tenantId,
    userId,
    departmentId,
    sessionId,
    messageId,
    source: "web" as const,
    value,
    traceId,
    provider,
    model,
    createdAt: now,
    updatedAt: now,
  };
  if (store.dialect === "mysql") {
    await store.db.insert(store.feedback).values(values).onDuplicateKeyUpdate({
      set: {
        value,
        departmentId,
        sessionId,
        source: "web" as const,
        traceId,
        provider,
        model,
        updatedAt: now,
      },
    });
  } else {
    await store.db.insert(store.feedback).values(values).onConflictDoUpdate({
      target: [store.feedback.tenantId, store.feedback.userId, store.feedback.messageId],
      set: {
        value,
        departmentId,
        sessionId,
        source: "web" as const,
        traceId,
        provider,
        model,
        updatedAt: now,
      },
    });
  }
  const record = await currentForMessage(store, input.actor, messageId);
  if (!record) throw new Error("feedback write did not persist");
  const counts = await countsForMessage(store, tenantId, messageId);
  return { feedback: record, view: viewFor(record, counts, messageId, sessionId) };
}

/** Cancel the current user's vote. Deleting is idempotent. */
export async function deleteChatMessageFeedback(input: {
  actor: ChatFeedbackActor;
  sessionId: string;
  messageId: string;
}): Promise<{ view: ChatFeedbackView }> {
  const store = await getFeedbackDb();
  const { tenantId, userId } = actorIds(input.actor);
  const sessionId = id(input.sessionId, "session_id");
  const messageId = id(input.messageId, "message_id");
  await ownedAssistantMessage(store, input.actor, sessionId, messageId);
  await store.db
    .delete(store.feedback)
    .where(
      and(
        eq(store.feedback.tenantId, tenantId),
        eq(store.feedback.userId, userId),
        eq(store.feedback.sessionId, sessionId),
        eq(store.feedback.messageId, messageId),
      ),
    );
  const counts = await countsForMessage(store, tenantId, messageId);
  return { view: viewFor(null, counts, messageId, sessionId) };
}

/** Return this user's votes plus aggregate counts for one owned session. */
export async function listChatMessageFeedback(input: {
  actor: ChatFeedbackActor;
  sessionId: string;
  messageIds?: string[];
}): Promise<ChatFeedbackView[]> {
  const store = await getFeedbackDb();
  const { tenantId, userId } = actorIds(input.actor);
  const sessionId = await assertOwnedSession(store, input.actor, input.sessionId);
  const messageIds = [...new Set((input.messageIds ?? []).map((value) => id(value, "message_id")))];
  if (messageIds.length > 100) {
    throw new ChatFeedbackValidationError("message_ids must contain at most 100 items");
  }
  const filters = [eq(store.feedback.tenantId, tenantId), eq(store.feedback.userId, userId), eq(store.feedback.sessionId, sessionId)];
  if (messageIds.length > 0) filters.push(inArray(store.feedback.messageId, messageIds));
  const rows = await store.db
    .select()
    .from(store.feedback)
    .where(and(...filters))
    .orderBy(desc(store.feedback.updatedAt));
  const existing = new Map<string, ChatFeedbackRecord>();
  for (const row of rows as Array<Record<string, unknown>>) {
    existing.set(String(row.messageId ?? row.message_id), mapRecord(row));
  }

  const targetIds = messageIds.length > 0 ? messageIds : [...existing.keys()];
  if (targetIds.length === 0) return [];

  // A caller may only hydrate messages that belong to this user's current
  // session.  Do this check before counting so a guessed message id cannot
  // turn the aggregate query into a cross-session or cross-user oracle.
  const ownedRows = await store.db
    .select({ id: store.messages.id })
    .from(store.messages)
    .where(
      and(
        eq(store.messages.sessionId, sessionId),
        eq(store.messages.tenantId, tenantId),
        eq(store.messages.userId, userId),
        eq(store.messages.role, "assistant"),
        eq(store.messages.status, "complete"),
        inArray(store.messages.id, targetIds),
      ),
    );
  const ownedIds = new Set(
    (ownedRows as Array<Record<string, unknown>>).map((row) => String(row.id)),
  );
  if (messageIds.length > 0 && ownedIds.size !== messageIds.length) {
    throw new ChatFeedbackTargetNotFoundError();
  }

  const visibleTargetIds = targetIds.filter((messageId) => ownedIds.has(messageId));
  if (visibleTargetIds.length === 0) return [];
  const countRows = await store.db
    .select({ messageId: store.feedback.messageId, value: store.feedback.value, count: sql<number>`count(*)` })
    .from(store.feedback)
    .where(
      and(
        eq(store.feedback.tenantId, tenantId),
        eq(store.feedback.sessionId, sessionId),
        inArray(store.feedback.messageId, visibleTargetIds),
      ),
    )
    .groupBy(store.feedback.messageId, store.feedback.value);
  const counts = new Map<string, ChatFeedbackCounts>();
  for (const row of countRows as Array<{ messageId: unknown; value: unknown; count: unknown }>) {
    const messageId = String(row.messageId);
    const next = counts.get(messageId) ?? { like: 0, dislike: 0, total: 0 };
    const valueCount = Number(row.count ?? 0);
    if (row.value === "like") next.like = valueCount;
    if (row.value === "dislike") next.dislike = valueCount;
    next.total = next.like + next.dislike;
    counts.set(messageId, next);
  }
  return visibleTargetIds.map((messageId) =>
    viewFor(existing.get(messageId) ?? null, counts.get(messageId) ?? { like: 0, dislike: 0, total: 0 }, messageId, sessionId),
  );
}

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { chatMessages as pgMessages } from "@agenticx/db-schema";
import { chatMessages as mysqlMessages } from "@agenticx/db-schema/mysql";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { getAdminMysqlDb } from "./db-stores/mysql/database";

/** Inline preview cap; the full body stays in DB until expand or download. */
export const TRACE_IO_PREVIEW_CHARS = 4_000;
/** Max chars returned to browser even when user expands (hard ceiling). */
export const TRACE_IO_EXPAND_CHARS = 32_000;

export type TraceIoText = {
  text: string;
  length: number;
  truncated: boolean;
};

export type TraceIoAttachment = {
  name?: string;
  mime?: string;
  size?: number;
};

export type TraceConversationMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  model?: string;
  created_at: string;
  /** Visible assistant/user body (think tags stripped for assistant). */
  content: TraceIoText;
  /** Reasoning / think block when present. */
  reasoning?: TraceIoText;
  attachments?: TraceIoAttachment[];
};

export type TraceConversationTurn = {
  trace_id: string;
  session_id: string | null;
  messages: TraceConversationMessage[];
  /** True when no chat_messages row carried this trace_id. */
  empty: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clipText(raw: string, limit: number): TraceIoText {
  const length = raw.length;
  if (length <= limit) {
    return { text: raw, length, truncated: false };
  }
  return { text: `${raw.slice(0, limit)}…`, length, truncated: true };
}

/** Minimal think-tag split (admin-side; avoids depending on features/chat). */
export function splitReasoning(raw: string): { display: string; reasoning: string } {
  if (!raw) return { display: "", reasoning: "" };
  const open = "<think>";
  const close = "</think>";
  const openAlt = "<" + "think" + ">";
  const closeAlt = "<" + "/" + "think" + ">";
  const normalized = raw.replaceAll(openAlt, open).replaceAll(closeAlt, close);
  const start = normalized.toLowerCase().indexOf(open);
  if (start < 0) return { display: raw.trim(), reasoning: "" };
  const bodyStart = start + open.length;
  const end = normalized.toLowerCase().indexOf(close, bodyStart);
  if (end < 0) {
    return {
      display: normalized.slice(0, start).trim(),
      reasoning: normalized.slice(bodyStart).trim(),
    };
  }
  return {
    display: `${normalized.slice(0, start)}${normalized.slice(end + close.length)}`.trim(),
    reasoning: normalized.slice(bodyStart, end).trim(),
  };
}

function parseAttachments(metadata: unknown): TraceIoAttachment[] | undefined {
  if (!isRecord(metadata)) return undefined;
  const list = metadata.attachments;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list.map((item) => {
    if (!isRecord(item)) return {};
    return {
      name: typeof item.name === "string" ? item.name : typeof item.filename === "string" ? item.filename : undefined,
      mime: typeof item.mime === "string" ? item.mime : typeof item.contentType === "string" ? item.contentType : undefined,
      size: typeof item.size === "number" ? item.size : undefined,
    };
  });
}

function mapRow(
  row: {
    id: string;
    role: string;
    content: string;
    model: string | null;
    createdAt: Date | string;
    metadata: unknown;
  },
  expand: boolean,
): TraceConversationMessage {
  const limit = expand ? TRACE_IO_EXPAND_CHARS : TRACE_IO_PREVIEW_CHARS;
  const role = (["user", "assistant", "tool", "system"].includes(row.role)
    ? row.role
    : "assistant") as TraceConversationMessage["role"];
  const created =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);

  if (role === "assistant") {
    const { display, reasoning } = splitReasoning(row.content ?? "");
    return {
      id: row.id,
      role,
      model: row.model ?? undefined,
      created_at: created,
      content: clipText(display, limit),
      reasoning: reasoning ? clipText(reasoning, limit) : undefined,
      attachments: parseAttachments(row.metadata),
    };
  }

  return {
    id: row.id,
    role,
    model: row.model ?? undefined,
    created_at: created,
    content: clipText(row.content ?? "", limit),
    attachments: parseAttachments(row.metadata),
  };
}

/**
 * Load the chat turn for a trace_id: assistant (metadata.trace_id) + preceding
 * user/tool messages until the previous user boundary.
 */
export async function getTraceConversationTurn(
  tenantId: string,
  traceId: string,
  options?: { expand?: boolean },
): Promise<TraceConversationTurn> {
  const tid = tenantId.trim();
  const tr = traceId.trim();
  const expand = Boolean(options?.expand);
  if (!tid || !tr) {
    return { trace_id: tr, session_id: null, messages: [], empty: true };
  }

  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql": {
      const db = getIamDb();
      const assistants = await db
        .select()
        .from(pgMessages)
        .where(
          and(
            eq(pgMessages.tenantId, tid),
            sql`${pgMessages.metadata}->>'trace_id' = ${tr}`,
          ),
        )
        .orderBy(desc(pgMessages.createdAt))
        .limit(1);
      const assistant = assistants[0];
      if (!assistant) {
        return { trace_id: tr, session_id: null, messages: [], empty: true };
      }
      const window = await db
        .select()
        .from(pgMessages)
        .where(
          and(
            eq(pgMessages.tenantId, tid),
            eq(pgMessages.sessionId, assistant.sessionId),
            lte(pgMessages.createdAt, assistant.createdAt),
          ),
        )
        .orderBy(desc(pgMessages.createdAt))
        .limit(40);
      const turn = pickTurnMessages(window);
      return {
        trace_id: tr,
        session_id: assistant.sessionId,
        messages: turn.map((row) => mapRow(row, expand)),
        empty: turn.length === 0,
      };
    }
    case "mysql": {
      const db = getAdminMysqlDb();
      const assistants = await db
        .select()
        .from(mysqlMessages)
        .where(
          and(
            eq(mysqlMessages.tenantId, tid),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${mysqlMessages.metadata}, '$.trace_id')) = ${tr}`,
          ),
        )
        .orderBy(desc(mysqlMessages.createdAt))
        .limit(1);
      const assistant = assistants[0];
      if (!assistant) {
        return { trace_id: tr, session_id: null, messages: [], empty: true };
      }
      const window = await db
        .select()
        .from(mysqlMessages)
        .where(
          and(
            eq(mysqlMessages.tenantId, tid),
            eq(mysqlMessages.sessionId, assistant.sessionId),
            lte(mysqlMessages.createdAt, assistant.createdAt),
          ),
        )
        .orderBy(desc(mysqlMessages.createdAt))
        .limit(40);
      const turn = pickTurnMessages(window);
      return {
        trace_id: tr,
        session_id: assistant.sessionId,
        messages: turn.map((row) => mapRow(row, expand)),
        empty: turn.length === 0,
      };
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** `rows` newest-first; keep from assistant/tool down through the nearest user. */
export function pickTurnMessages<T extends { role: string }>(rows: T[]): T[] {
  const collected: T[] = [];
  for (const row of rows) {
    collected.push(row);
    if (row.role === "user") break;
  }
  return collected.reverse();
}

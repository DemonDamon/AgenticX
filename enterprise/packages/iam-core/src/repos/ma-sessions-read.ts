import { maSessionEvents as pgEvents, maSessions as pgSessions, maWorkItems as pgWorkItems } from "@agenticx/db-schema";
import { and, asc, desc, eq, gt, gte, inArray, lt, type SQL } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import {
  mysqlFindMaSession,
  mysqlListMaSessionEvents,
  mysqlListMaSessions,
  mysqlListMaWorkItems,
} from "./mysql/ma-sessions-read";

export type MaSessionSummary = {
  id: string;
  tenantId: string;
  agentId: string;
  agentVersion: number;
  environmentId: string | null;
  createdByUserId: string | null;
  source: string;
  status: string;
  stopReason: Record<string, unknown> | null;
  title: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    tool_calls: number;
    runtime_ms: number;
  };
  lastSeq: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaSessionDetail = MaSessionSummary & {
  vaultIds: string[];
  resources: Record<string, unknown>[];
  metadata: Record<string, unknown>;
};

export type MaSessionEventView = {
  id: string;
  sessionId: string;
  seq: number;
  threadId: string | null;
  type: string;
  createdAt: string;
  processedAt: string | null;
  /** 还原后的 wire 事件。值为 null 的键省略。 */
  event: Record<string, unknown>;
};

export type MaWorkItemView = {
  id: string;
  sessionId: string;
  environmentId: string;
  status: string;
  claimedByUserId: string | null;
  claimedByDevice: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  attempts: number;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListMaSessionsFilter = {
  agentId?: string;
  userId?: string;
  status?: string;
  source?: string;
  beforeId?: string;
  limit?: number;
  /** ISO-8601；created_at >= createdFrom。非法值忽略。 */
  createdFrom?: string;
  /** ISO-8601；created_at < createdTo。非法值忽略。 */
  createdTo?: string;
};

/** 纯函数：把 ISO 字符串解析为 Date；空串、非法时间返回 null。导出供测试。 */
export function resolveCreatedRange(
  filter: Pick<ListMaSessionsFilter, "createdFrom" | "createdTo"> | undefined,
): { from: Date | null; to: Date | null } {
  return {
    from: parseCreatedBound(filter?.createdFrom),
    to: parseCreatedBound(filter?.createdTo),
  };
}

function parseCreatedBound(value: string | undefined): Date | null {
  if (value == null || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

const EVENT_TYPE_RE = /^[a-z_]+(\.[a-z_]+)*$/;

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) return row[key];
  }
  return undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : {};
}

function asNumber(value: unknown): number {
  const parsed = parseJson(value);
  const n = Number(parsed ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : value;
  return parsed instanceof Date ? parsed.toISOString() : String(parsed ?? "");
}

function nullableString(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function nullableIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  return iso(value);
}

export function clampLimit(value: number | undefined, def: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return def;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

function mapUsage(raw: unknown): MaSessionSummary["usage"] {
  const parsed = parseJson(raw);
  const record = isRecord(parsed) ? parsed : {};
  return {
    input_tokens: asNumber(record.input_tokens),
    output_tokens: asNumber(record.output_tokens),
    cache_read_input_tokens: asNumber(record.cache_read_input_tokens),
    tool_calls: asNumber(record.tool_calls),
    runtime_ms: asNumber(record.runtime_ms),
  };
}

export function mapSessionRow(row: Record<string, unknown>): MaSessionDetail {
  const stopRaw = parseJson(field(row, "stopReason", "stop_reason"));
  const vaultRaw = parseJson(field(row, "vaultIds", "vault_ids"));
  const resourcesRaw = parseJson(field(row, "resources", "resources"));
  const metadataRaw = parseJson(field(row, "metadata", "metadata"));
  return {
    id: String(field(row, "id") ?? ""),
    tenantId: String(field(row, "tenantId", "tenant_id") ?? ""),
    agentId: String(field(row, "agentId", "agent_id") ?? ""),
    agentVersion: asNumber(field(row, "agentVersion", "agent_version")),
    environmentId: nullableString(field(row, "environmentId", "environment_id")),
    createdByUserId: nullableString(field(row, "createdByUserId", "created_by_user_id")),
    source: String(field(row, "source") ?? ""),
    status: String(field(row, "status") ?? ""),
    stopReason: isRecord(stopRaw) ? stopRaw : null,
    title: nullableString(field(row, "title")),
    usage: mapUsage(field(row, "usageTotals", "usage_totals", "usage")),
    lastSeq: asNumber(field(row, "lastSeq", "last_seq")),
    archivedAt: nullableIso(field(row, "archivedAt", "archived_at")),
    createdAt: iso(field(row, "createdAt", "created_at")),
    updatedAt: iso(field(row, "updatedAt", "updated_at")),
    vaultIds: Array.isArray(vaultRaw) ? vaultRaw.map((item) => String(item)) : [],
    resources: Array.isArray(resourcesRaw) ? resourcesRaw.filter(isRecord) : [],
    metadata: isRecord(metadataRaw) ? metadataRaw : {},
  };
}

export function mapEventRow(row: Record<string, unknown>): MaSessionEventView {
  const payload = asObject(field(row, "payload"));
  const id = String(field(row, "id") ?? "");
  const sessionId = String(field(row, "sessionId", "session_id") ?? "");
  const seq = asNumber(field(row, "seq"));
  const threadId = nullableString(field(row, "threadId", "thread_id"));
  const type = String(field(row, "type") ?? "");
  const createdAt = iso(field(row, "createdAt", "created_at"));
  const processedAt = nullableIso(field(row, "processedAt", "processed_at"));
  const event: Record<string, unknown> = {
    ...payload,
    id,
    session_id: sessionId,
    seq,
    type,
    created_at: createdAt,
  };
  if (threadId) event.thread_id = threadId;
  else delete event.thread_id;
  if (processedAt) event.processed_at = processedAt;
  else delete event.processed_at;
  return { id, sessionId, seq, threadId, type, createdAt, processedAt, event };
}

export function mapWorkItemRow(row: Record<string, unknown>): MaWorkItemView {
  return {
    id: String(field(row, "id") ?? ""),
    sessionId: String(field(row, "sessionId", "session_id") ?? ""),
    environmentId: String(field(row, "environmentId", "environment_id") ?? ""),
    status: String(field(row, "status") ?? ""),
    claimedByUserId: nullableString(field(row, "claimedByUserId", "claimed_by_user_id")),
    claimedByDevice: nullableString(field(row, "claimedByDevice", "claimed_by_device")),
    claimedAt: nullableIso(field(row, "claimedAt", "claimed_at")),
    leaseExpiresAt: nullableIso(field(row, "leaseExpiresAt", "lease_expires_at")),
    lastHeartbeatAt: nullableIso(field(row, "lastHeartbeatAt", "last_heartbeat_at")),
    attempts: asNumber(field(row, "attempts")),
    completedAt: nullableIso(field(row, "completedAt", "completed_at")),
    error: nullableString(field(row, "error")),
    createdAt: iso(field(row, "createdAt", "created_at")),
    updatedAt: iso(field(row, "updatedAt", "updated_at")),
  };
}

function cleanTypes(types: string[] | undefined): string[] {
  if (!types) return [];
  const out: string[] = [];
  for (const raw of types) {
    const value = String(raw ?? "").trim();
    if (EVENT_TYPE_RE.test(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

function asRow(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** 按 id 倒序（ULID ≈ 时间倒序）。 */
export async function listMaSessions(
  tenantId: string,
  filter?: ListMaSessionsFilter,
): Promise<{ items: MaSessionSummary[]; nextBeforeId: string | null }> {
  const limit = clampLimit(filter?.limit, 50, 200);
  const range = resolveCreatedRange(filter);
  const query = {
    agentId: filter?.agentId,
    userId: filter?.userId,
    status: filter?.status,
    source: filter?.source,
    beforeId: filter?.beforeId,
    limit,
    createdFrom: range.from,
    createdTo: range.to,
  };
  const rows = isMysql()
    ? await mysqlListMaSessions(tenantId, query)
    : await (async () => {
        const filters: SQL[] = [eq(pgSessions.tenantId, tenantId)];
        if (query.agentId) filters.push(eq(pgSessions.agentId, query.agentId));
        if (query.userId) filters.push(eq(pgSessions.createdByUserId, query.userId));
        if (query.status) filters.push(eq(pgSessions.status, query.status));
        if (query.source) filters.push(eq(pgSessions.source, query.source));
        if (query.beforeId) filters.push(lt(pgSessions.id, query.beforeId));
        if (query.createdFrom) filters.push(gte(pgSessions.createdAt, query.createdFrom));
        if (query.createdTo) filters.push(lt(pgSessions.createdAt, query.createdTo));
        return getIamDb()
          .select()
          .from(pgSessions)
          .where(and(...filters))
          .orderBy(desc(pgSessions.id))
          .limit(limit);
      })();
  const items = (rows as unknown[]).map((row) => mapSessionRow(asRow(row)));
  const last = items.length === limit ? items[items.length - 1] : undefined;
  return { items, nextBeforeId: last ? last.id : null };
}

export async function getMaSession(tenantId: string, id: string): Promise<MaSessionDetail | null> {
  const row = isMysql()
    ? await mysqlFindMaSession(tenantId, id)
    : (
        await getIamDb()
          .select()
          .from(pgSessions)
          .where(and(eq(pgSessions.tenantId, tenantId), eq(pgSessions.id, id)))
          .limit(1)
      )[0];
  return row ? mapSessionRow(asRow(row)) : null;
}

/** seq > afterSeq，按 seq 升序。 */
export async function listMaSessionEvents(
  tenantId: string,
  sessionId: string,
  opts?: { afterSeq?: number; limit?: number; types?: string[] },
): Promise<{ items: MaSessionEventView[]; nextAfterSeq: number | null }> {
  const limit = clampLimit(opts?.limit, 100, 500);
  const afterSeq = opts?.afterSeq ?? 0;
  const types = cleanTypes(opts?.types);
  const rows = isMysql()
    ? await mysqlListMaSessionEvents(tenantId, sessionId, { afterSeq, limit, types })
    : await (async () => {
        const filters: SQL[] = [
          eq(pgEvents.tenantId, tenantId),
          eq(pgEvents.sessionId, sessionId),
          gt(pgEvents.seq, afterSeq),
        ];
        if (types.length > 0) filters.push(inArray(pgEvents.type, types));
        return getIamDb()
          .select()
          .from(pgEvents)
          .where(and(...filters))
          .orderBy(asc(pgEvents.seq))
          .limit(limit);
      })();
  const items = (rows as unknown[]).map((row) => mapEventRow(asRow(row)));
  const last = items.length === limit ? items[items.length - 1] : undefined;
  return { items, nextAfterSeq: last ? last.seq : null };
}

export async function listMaWorkItems(tenantId: string, sessionId: string): Promise<MaWorkItemView[]> {
  const rows = isMysql()
    ? await mysqlListMaWorkItems(tenantId, sessionId)
    : await getIamDb()
        .select()
        .from(pgWorkItems)
        .where(and(eq(pgWorkItems.tenantId, tenantId), eq(pgWorkItems.sessionId, sessionId)))
        .orderBy(asc(pgWorkItems.createdAt));
  return (rows as unknown[]).map((row) => mapWorkItemRow(asRow(row)));
}

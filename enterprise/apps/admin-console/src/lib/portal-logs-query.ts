import { and, count, desc, eq, gte, inArray, isNull, like, lte, or, type SQL } from "drizzle-orm";
import { portalRequestLogs as pgPortalRequestLogs } from "@agenticx/db-schema";
import { portalRequestLogs as mysqlPortalRequestLogs } from "@agenticx/db-schema/mysql";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { getAdminMysqlDb } from "./db-stores/mysql/database";

export type PortalLogQueryInput = {
  tenant_id: string;
  trace_id?: string;
  user_id?: string;
  session_id?: string;
  level?: string;
  event?: string;
  route?: string;
  mode?: string;
  run_id?: string;
  start?: string;
  end?: string;
  limit: number;
  offset: number;
};

export type PortalLogItem = {
  id: string;
  tenant_id: string;
  log_time: string;
  level: string;
  event: string;
  trace_id: string | null;
  user_id: string | null;
  session_id: string | null;
  route: string | null;
  mode: string | null;
  run_id: string | null;
  status: number | null;
  duration_ms: number | null;
  error_name: string | null;
  error_message: string | null;
  error_stack: string | null;
  fields: Record<string, unknown> | null;
};

export type PortalLogQueryResult = {
  total: number;
  items: PortalLogItem[];
};

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.min(Math.floor(limit), 500);
}

function clampOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

function parseTime(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function mapRow(row: {
  id: string;
  tenantId: string;
  logTime: Date | string;
  level: string;
  event: string;
  traceId: string | null;
  userId: string | null;
  sessionId: string | null;
  route: string | null;
  mode: string | null;
  runId: string | null;
  status: number | null;
  durationMs: number | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  fields: Record<string, unknown> | null;
}): PortalLogItem {
  const logTime =
    row.logTime instanceof Date ? row.logTime.toISOString() : new Date(row.logTime).toISOString();
  return {
    id: row.id,
    tenant_id: row.tenantId,
    log_time: logTime,
    level: row.level,
    event: row.event,
    trace_id: row.traceId,
    user_id: row.userId,
    session_id: row.sessionId,
    route: row.route,
    mode: row.mode,
    run_id: row.runId,
    status: row.status,
    duration_ms: row.durationMs,
    error_name: row.errorName,
    error_message: row.errorMessage,
    error_stack: row.errorStack,
    fields: row.fields,
  };
}

function levelCondition(
  table: typeof pgPortalRequestLogs | typeof mysqlPortalRequestLogs,
  level: string | undefined,
): SQL | undefined {
  if (!level) return undefined;
  if (level === "warn+") {
    return inArray(table.level, ["warn", "error"]);
  }
  return eq(table.level, level);
}

function modeCondition(
  table: typeof pgPortalRequestLogs | typeof mysqlPortalRequestLogs,
  mode: string | undefined,
): SQL | undefined {
  if (!mode) return undefined;
  // 遗留行 mode 为 NULL 时按 route 兜底，避免历史数据在筛选下彻底消失。
  if (mode === "deep_research") {
    return or(
      eq(table.mode, "deep_research"),
      and(isNull(table.mode), like(table.route, "deep_research%")),
    );
  }
  if (mode === "chat") {
    return or(
      eq(table.mode, "chat"),
      and(isNull(table.mode), eq(table.route, "chat.completions")),
    );
  }
  return eq(table.mode, mode);
}

export function buildPortalLogConditions(
  table: typeof pgPortalRequestLogs | typeof mysqlPortalRequestLogs,
  input: PortalLogQueryInput,
  start: Date | undefined,
  end: Date | undefined,
): SQL[] {
  const conditions: SQL[] = [eq(table.tenantId, input.tenant_id)];
  if (input.trace_id) conditions.push(eq(table.traceId, input.trace_id));
  if (input.user_id) conditions.push(eq(table.userId, input.user_id));
  if (input.session_id) conditions.push(eq(table.sessionId, input.session_id));
  const lvl = levelCondition(table, input.level);
  if (lvl) conditions.push(lvl);
  if (input.event) conditions.push(eq(table.event, input.event));
  if (input.route) conditions.push(eq(table.route, input.route));
  const md = modeCondition(table, input.mode);
  if (md) conditions.push(md);
  if (input.run_id) conditions.push(eq(table.runId, input.run_id));
  if (start) conditions.push(gte(table.logTime, start));
  if (end) conditions.push(lte(table.logTime, end));
  return conditions;
}

export async function queryPortalLogs(input: PortalLogQueryInput): Promise<PortalLogQueryResult> {
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);
  const start = parseTime(input.start);
  const end = parseTime(input.end);
  const config = resolveDatabaseConfig();

  switch (config.dialect) {
    case "postgresql": {
      const db = getIamDb();
      const table = pgPortalRequestLogs;
      const where = and(...buildPortalLogConditions(table, input, start, end));

      const [totalRow] = await db.select({ value: count() }).from(table).where(where);
      const rows = await db
        .select()
        .from(table)
        .where(where)
        .orderBy(desc(table.logTime))
        .limit(limit)
        .offset(offset);
      return {
        total: Number(totalRow?.value ?? 0),
        items: rows.map(mapRow),
      };
    }
    case "mysql": {
      const db = getAdminMysqlDb();
      const table = mysqlPortalRequestLogs;
      const where = and(...buildPortalLogConditions(table, input, start, end));

      const [totalRow] = await db.select({ value: count() }).from(table).where(where);
      const rows = await db
        .select()
        .from(table)
        .where(where)
        .orderBy(desc(table.logTime))
        .limit(limit)
        .offset(offset);
      return {
        total: Number(totalRow?.value ?? 0),
        items: rows.map(mapRow),
      };
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Exported for route tests — mirrors clamp used by queryPortalLogs. */
export function normalizePortalLogLimit(limit: unknown): number {
  return clampLimit(typeof limit === "number" ? limit : 100);
}

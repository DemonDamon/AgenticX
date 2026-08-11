import { and, count, desc, isNotNull, isNull, sql } from "drizzle-orm";
import { portalRequestLogs as pgPortalRequestLogs } from "@agenticx/db-schema";
import { portalRequestLogs as mysqlPortalRequestLogs } from "@agenticx/db-schema/mysql";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { getAdminMysqlDb } from "./db-stores/mysql/database";
import {
  buildPortalLogConditions,
  normalizePortalLogLimit,
  type PortalLogQueryInput,
} from "./portal-logs-query";

/** Default lookback when the caller omits both start and end (avoids full-table GROUP BY). */
export const DEFAULT_SESSION_WINDOW_DAYS = 7;

export type PortalSessionRollup = {
  session_id: string;
  turns: number;
  first_time: string;
  last_time: string;
  total_duration_ms: number | null;
  error_count: number;
  modes: string[];
  user_id: string | null;
};

export type PortalSessionRollupResult = {
  total: number;
  items: PortalSessionRollup[];
  ungrouped_count: number;
};

function clampOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

function parseTime(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Split dialect `string_agg` / `GROUP_CONCAT` CSV into unique non-empty modes. */
export function parseModesCsv(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const mode = part.trim();
    if (!mode || seen.has(mode)) continue;
    seen.add(mode);
    out.push(mode);
  }
  return out;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function resolveWindow(input: PortalLogQueryInput): { start: Date | undefined; end: Date | undefined } {
  let start = parseTime(input.start);
  let end = parseTime(input.end);
  if (!start && !end) {
    start = new Date(Date.now() - DEFAULT_SESSION_WINDOW_DAYS * 864e5);
  }
  return { start, end };
}

function mapRollup(row: {
  sessionId: string | null;
  turns: number | string | null;
  firstTime: Date | string | null;
  lastTime: Date | string | null;
  totalDurationMs: number | string | null;
  errorCount: number | string | null;
  modes: string | null;
  userId: string | null;
}): PortalSessionRollup | null {
  if (!row.sessionId) return null;
  const totalDuration =
    row.totalDurationMs == null || row.totalDurationMs === ""
      ? null
      : Number(row.totalDurationMs);
  return {
    session_id: row.sessionId,
    turns: Number(row.turns ?? 0),
    first_time: toIso(row.firstTime),
    last_time: toIso(row.lastTime),
    total_duration_ms: totalDuration == null || Number.isNaN(totalDuration) ? null : totalDuration,
    error_count: Number(row.errorCount ?? 0),
    modes: parseModesCsv(row.modes),
    user_id: row.userId,
  };
}

export async function queryPortalLogSessions(
  input: PortalLogQueryInput,
): Promise<PortalSessionRollupResult> {
  const limit = normalizePortalLogLimit(input.limit);
  const offset = clampOffset(input.offset);
  const { start, end } = resolveWindow(input);
  const config = resolveDatabaseConfig();

  switch (config.dialect) {
    case "postgresql": {
      const db = getIamDb();
      const table = pgPortalRequestLogs;
      const base = buildPortalLogConditions(table, input, start, end);
      const groupedWhere = and(...base, isNotNull(table.sessionId));
      const ungroupedWhere = and(...base, isNull(table.sessionId));

      const [totalRow] = await db
        .select({ value: sql<number>`count(distinct ${table.sessionId})` })
        .from(table)
        .where(groupedWhere);
      const [ungroupedRow] = await db.select({ value: count() }).from(table).where(ungroupedWhere);
      const rows = await db
        .select({
          sessionId: table.sessionId,
          turns: sql<number>`count(distinct ${table.traceId})`,
          firstTime: sql<Date>`min(${table.logTime})`,
          lastTime: sql<Date>`max(${table.logTime})`,
          totalDurationMs: sql<number | null>`sum(${table.durationMs})`,
          errorCount: sql<number>`sum(case when ${table.level} = 'error' then 1 else 0 end)`,
          modes: sql<string>`string_agg(distinct coalesce(${table.mode}, 'chat'), ',')`,
          userId: sql<string | null>`max(${table.userId})`,
        })
        .from(table)
        .where(groupedWhere)
        .groupBy(table.sessionId)
        .orderBy(desc(sql`max(${table.logTime})`))
        .limit(limit)
        .offset(offset);

      return {
        total: Number(totalRow?.value ?? 0),
        items: rows.map(mapRollup).filter((row): row is PortalSessionRollup => row != null),
        ungrouped_count: Number(ungroupedRow?.value ?? 0),
      };
    }
    case "mysql": {
      const db = getAdminMysqlDb();
      const table = mysqlPortalRequestLogs;
      const base = buildPortalLogConditions(table, input, start, end);
      const groupedWhere = and(...base, isNotNull(table.sessionId));
      const ungroupedWhere = and(...base, isNull(table.sessionId));

      const [totalRow] = await db
        .select({ value: sql<number>`count(distinct ${table.sessionId})` })
        .from(table)
        .where(groupedWhere);
      const [ungroupedRow] = await db.select({ value: count() }).from(table).where(ungroupedWhere);
      const rows = await db
        .select({
          sessionId: table.sessionId,
          turns: sql<number>`count(distinct ${table.traceId})`,
          firstTime: sql<Date>`min(${table.logTime})`,
          lastTime: sql<Date>`max(${table.logTime})`,
          totalDurationMs: sql<number | null>`sum(${table.durationMs})`,
          errorCount: sql<number>`sum(case when ${table.level} = 'error' then 1 else 0 end)`,
          modes: sql<string>`GROUP_CONCAT(DISTINCT COALESCE(${table.mode}, 'chat'))`,
          userId: sql<string | null>`max(${table.userId})`,
        })
        .from(table)
        .where(groupedWhere)
        .groupBy(table.sessionId)
        .orderBy(desc(sql`max(${table.logTime})`))
        .limit(limit)
        .offset(offset);

      return {
        total: Number(totalRow?.value ?? 0),
        items: rows.map(mapRollup).filter((row): row is PortalSessionRollup => row != null),
        ungrouped_count: Number(ungroupedRow?.value ?? 0),
      };
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Search and deep-research usage over a date range, read from the same daily
 * counters the ceilings are enforced against.
 */

import { enterpriseFeatureUsageDaily as pgTable } from "@agenticx/db-schema";
import { enterpriseFeatureUsageDaily as mysqlTable } from "@agenticx/db-schema/mysql";
import { METERED_FEATURES, utcUsageDay, type MeteredFeature } from "@agenticx/config";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { getAdminMysqlDb } from "./db-stores/mysql/database";

export type FeatureUsageTrendPoint = {
  day: string;
  searchCalls: number;
  researchRuns: number;
  searchUsers: number;
  researchUsers: number;
};

export type FeatureUsageTrendResult = {
  points: FeatureUsageTrendPoint[];
  totals: {
    searchCalls: number;
    researchRuns: number;
    searchUsers: number;
    researchUsers: number;
  };
};

type RawRow = {
  day: string;
  feature: string;
  used: number;
  users: number;
};

type TrendQueryInput = {
  tenantId: string;
  fromDay: string;
  toDay: string;
  deptIds: string[];
  userIds: string[];
};

function emptyPoint(day: string): FeatureUsageTrendPoint {
  return { day, searchCalls: 0, researchRuns: 0, searchUsers: 0, researchUsers: 0 };
}

export function usageDaysBetween(startDay: string, endDay: string, limit = 400): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return days;
  while (cursor <= end && days.length < limit) {
    days.push(utcUsageDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function foldFeatureUsageRows(
  rows: readonly RawRow[],
  days: readonly string[],
): FeatureUsageTrendPoint[] {
  const byDay = new Map(days.map((day) => [day, emptyPoint(day)]));
  for (const row of rows) {
    const point = byDay.get(row.day);
    if (!point) continue;
    if (row.feature === "search_provider_calls") {
      point.searchCalls += Number(row.used ?? 0);
      point.searchUsers += Number(row.users ?? 0);
    } else if (row.feature === "deep_research_runs") {
      point.researchRuns += Number(row.used ?? 0);
      point.researchUsers += Number(row.users ?? 0);
    }
  }
  return days.map((day) => byDay.get(day) ?? emptyPoint(day));
}

function toRawRow(row: { day: unknown; feature: unknown; used: unknown; users: unknown }): RawRow {
  return {
    day: String(row.day),
    feature: String(row.feature),
    used: Number(row.used ?? 0),
    users: Number(row.users ?? 0),
  };
}

function filters(table: typeof pgTable | typeof mysqlTable, input: TrendQueryInput, feature?: MeteredFeature) {
  return and(
    eq(table.tenantId, input.tenantId),
    feature ? eq(table.feature, feature) : inArray(table.feature, [...METERED_FEATURES]),
    gte(table.usageDay, input.fromDay),
    lte(table.usageDay, input.toDay),
    ...(input.deptIds.length > 0 ? [inArray(table.deptId, input.deptIds)] : []),
    ...(input.userIds.length > 0 ? [inArray(table.userId, input.userIds)] : []),
  );
}

async function pgDailyRows(input: TrendQueryInput): Promise<RawRow[]> {
  const rows = await getIamDb()
    .select({
      day: pgTable.usageDay,
      feature: pgTable.feature,
      used: sql<number>`coalesce(sum(${pgTable.used}), 0)`,
      users: sql<number>`count(distinct ${pgTable.userId})`,
    })
    .from(pgTable)
    .where(filters(pgTable, input))
    .groupBy(pgTable.usageDay, pgTable.feature);
  return rows.map(toRawRow);
}

async function mysqlDailyRows(input: TrendQueryInput): Promise<RawRow[]> {
  const rows = await getAdminMysqlDb()
    .select({
      day: mysqlTable.usageDay,
      feature: mysqlTable.feature,
      used: sql<number>`coalesce(sum(${mysqlTable.used}), 0)`,
      users: sql<number>`count(distinct ${mysqlTable.userId})`,
    })
    .from(mysqlTable)
    .where(filters(mysqlTable, input))
    .groupBy(mysqlTable.usageDay, mysqlTable.feature);
  return rows.map(toRawRow);
}

async function pgDistinctUsers(input: TrendQueryInput & { feature: MeteredFeature }): Promise<number> {
  const rows = await getIamDb()
    .select({ users: sql<number>`count(distinct ${pgTable.userId})` })
    .from(pgTable)
    .where(filters(pgTable, input, input.feature));
  return Number(rows[0]?.users ?? 0);
}

async function mysqlDistinctUsers(input: TrendQueryInput & { feature: MeteredFeature }): Promise<number> {
  const rows = await getAdminMysqlDb()
    .select({ users: sql<number>`count(distinct ${mysqlTable.userId})` })
    .from(mysqlTable)
    .where(filters(mysqlTable, input, input.feature));
  return Number(rows[0]?.users ?? 0);
}

function onMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

export async function readFeatureUsageTrend(input: {
  tenantId: string;
  fromDay: string;
  toDay: string;
  deptIds?: string[];
  userIds?: string[];
}): Promise<FeatureUsageTrendResult> {
  const query: TrendQueryInput = {
    tenantId: input.tenantId,
    fromDay: input.fromDay,
    toDay: input.toDay,
    deptIds: (input.deptIds ?? []).filter(Boolean),
    userIds: (input.userIds ?? []).filter(Boolean),
  };
  const days = usageDaysBetween(query.fromDay, query.toDay);
  const readRows = onMysql() ? mysqlDailyRows : pgDailyRows;
  const readUsers = onMysql() ? mysqlDistinctUsers : pgDistinctUsers;
  const [rows, searchUsers, researchUsers] = await Promise.all([
    readRows(query),
    readUsers({ ...query, feature: "search_provider_calls" }),
    readUsers({ ...query, feature: "deep_research_runs" }),
  ]);
  const points = foldFeatureUsageRows(rows, days);
  return {
    points,
    totals: {
      searchCalls: points.reduce((sum, point) => sum + point.searchCalls, 0),
      researchRuns: points.reduce((sum, point) => sum + point.researchRuns, 0),
      searchUsers,
      researchUsers,
    },
  };
}

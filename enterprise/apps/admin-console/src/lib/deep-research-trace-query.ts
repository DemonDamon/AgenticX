import { and, desc, eq } from "drizzle-orm";
import { enterpriseDeepResearchRuns as pgRuns } from "@agenticx/db-schema";
import { enterpriseDeepResearchRuns as mysqlRuns } from "@agenticx/db-schema/mysql";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { getAdminMysqlDb } from "./db-stores/mysql/database";

export type DeepResearchRunByTrace = {
  runId: string;
  sessionId: string;
  status: string;
  phase: string;
  topic: string;
  events: unknown[];
  createdAt: string;
  updatedAt: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asEvents(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Lookup deep-research run by tenant + trace_id.
 * Both filters are required for multi-tenant isolation.
 */
export async function getDeepResearchRunByTrace(
  tenantId: string,
  traceId: string,
): Promise<DeepResearchRunByTrace | null> {
  const tid = tenantId.trim();
  const tr = traceId.trim();
  if (!tid || !tr) return null;

  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql": {
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgRuns)
        .where(and(eq(pgRuns.tenantId, tid), eq(pgRuns.traceId, tr)))
        .orderBy(desc(pgRuns.createdAt))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        runId: row.runId,
        sessionId: row.sessionId,
        status: row.status,
        phase: row.phase,
        topic: row.topic,
        events: asEvents(row.events),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      };
    }
    case "mysql": {
      const db = getAdminMysqlDb();
      const rows = await db
        .select()
        .from(mysqlRuns)
        .where(and(eq(mysqlRuns.tenantId, tid), eq(mysqlRuns.traceId, tr)))
        .orderBy(desc(mysqlRuns.createdAt))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        runId: row.runId,
        sessionId: row.sessionId,
        status: row.status,
        phase: row.phase,
        topic: row.topic,
        events: asEvents(row.events),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      };
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

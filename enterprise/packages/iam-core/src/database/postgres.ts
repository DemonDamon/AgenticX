import {
  agentTokenTraces,
  auditEvents,
  authRefreshSessions,
  departments,
  enterpriseRuntimeModelProviders,
  enterpriseRuntimePolicySnapshots,
  enterpriseRuntimePricing,
  enterpriseRuntimeBudgets,
  enterpriseRuntimeCompliance,
  enterpriseRuntimePatRevocation,
  enterpriseRuntimeTokenQuotas,
  enterpriseQuotaPlans,
  enterpriseQuotaPlanAssignments,
  enterpriseRuntimeUserVisibleModels,
  gatewayAuditEvents,
  gatewayBudgetAlerts,
  gatewayQuotaPoolUsage,
  sessionGrants,
  organizations,
  roles,
  ssoProviders,
  userRoles,
  users,
} from "@agenticx/db-schema";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DatabaseConfig } from "./config";
import type { QueryExecutor } from "./types";

export const pgSchema = {
  users,
  departments,
  organizations,
  roles,
  userRoles,
  ssoProviders,
  auditEvents,
  gatewayAuditEvents,
  enterpriseRuntimeModelProviders,
  enterpriseRuntimeUserVisibleModels,
  enterpriseRuntimeTokenQuotas,
  enterpriseQuotaPlans,
  enterpriseQuotaPlanAssignments,
  enterpriseRuntimePolicySnapshots,
  enterpriseRuntimePricing,
  enterpriseRuntimeBudgets,
  gatewayBudgetAlerts,
  gatewayQuotaPoolUsage,
  sessionGrants,
  enterpriseRuntimeCompliance,
  enterpriseRuntimePatRevocation,
  authRefreshSessions,
  agentTokenTraces,
};

export type PgIamDbSchema = typeof pgSchema;
export type PgIamDb = NodePgDatabase<PgIamDbSchema>;

declare global {
  // eslint-disable-next-line no-var
  var __agenticxIamPgPool: Pool | undefined;
}

let pgDbSingleton: PgIamDb | null = null;

export function createPgPool(url: string): Pool {
  if (!globalThis.__agenticxIamPgPool) {
    globalThis.__agenticxIamPgPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalThis.__agenticxIamPgPool;
}

export function createPgDb(config: Extract<DatabaseConfig, { dialect: "postgresql" }>): PgIamDb {
  if (!pgDbSingleton) {
    pgDbSingleton = drizzle(createPgPool(config.url), { schema: pgSchema });
  }
  return pgDbSingleton;
}

export function createPgQueryExecutor(db: PgIamDb): QueryExecutor {
  return {
    dialect: "postgresql",
    async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      return db.transaction(async (txDb) => {
        const nested: QueryExecutor = {
          dialect: "postgresql",
          transaction: (inner) =>
            // Nested transactions use the same tx client surface.
            Promise.resolve(inner(nested)),
        };
        // Attach drizzle tx for adapters that cast internally.
        (nested as QueryExecutor & { __drizzle?: PgIamDb }).__drizzle = txDb as unknown as PgIamDb;
        (nested as QueryExecutor & { __pgDb?: PgIamDb }).__pgDb = txDb as unknown as PgIamDb;
        return fn(nested);
      });
    },
  };
}

export function resetPgDatabaseForTests(): void {
  pgDbSingleton = null;
  void globalThis.__agenticxIamPgPool?.end().catch(() => undefined);
  globalThis.__agenticxIamPgPool = undefined;
}

/** Internal: adapters may retrieve the underlying drizzle client. */
export function getPgDrizzle(db: PgIamDb | QueryExecutor): PgIamDb {
  if ("__pgDb" in db && (db as { __pgDb?: PgIamDb }).__pgDb) {
    return (db as { __pgDb: PgIamDb }).__pgDb;
  }
  if ("select" in db) return db as PgIamDb;
  throw new Error("PostgreSQL drizzle client unavailable on QueryExecutor");
}

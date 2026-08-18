import { enterpriseRuntimeBudgets as pgBudgetTable } from "@agenticx/db-schema";
import { enterpriseRuntimeBudgets as mysqlBudgetTable } from "@agenticx/db-schema/mysql";
import {
  DEFAULT_SESSION_TOKEN_LIMITS,
  normalizeSessionTokenLimits,
  type SessionTokenLimits,
} from "@agenticx/config";
import {
  createMysqlDb,
  getIamDb,
  resolveDatabaseConfig,
} from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

function limitsFromConfig(config: unknown): SessionTokenLimits {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  }
  return normalizeSessionTokenLimits(
    (config as Record<string, unknown>).sessionTokenLimits,
  );
}

/** Load the managed Desktop policy for the tenant authenticated by the PAT. */
export async function loadDesktopSessionTokenLimits(
  tenantId: string,
): Promise<SessionTokenLimits> {
  const tid = tenantId.trim();
  if (!tid || !process.env.DATABASE_URL?.trim()) {
    return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  }

  try {
    const database = resolveDatabaseConfig();
    if (database.dialect === "mysql") {
      const { raw: db } = await createMysqlDb(database);
      const rows = await db
        .select({ config: mysqlBudgetTable.config })
        .from(mysqlBudgetTable)
        .where(eq(mysqlBudgetTable.tenantId, tid))
        .limit(1);
      return limitsFromConfig(rows[0]?.config);
    }

    const db = getIamDb();
    const rows = await db
      .select({ config: pgBudgetTable.config })
      .from(pgBudgetTable)
      .where(eq(pgBudgetTable.tenantId, tid))
      .limit(1);
    return limitsFromConfig(rows[0]?.config);
  } catch (error) {
    // This policy augments the authenticated bootstrap response. A database
    // that has not run the budget-table migration yet, or a transient policy
    // read failure, must not make enterprise sign-in unusable.
    console.warn(
      "[desktop-token-policy] managed policy unavailable; using defaults",
      error,
    );
    return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  }
}

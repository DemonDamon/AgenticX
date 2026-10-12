import {
  DEFAULT_DESKTOP_AGENT_ACTION_POLICY,
  normalizeDesktopAgentActionPolicy,
  type DesktopAgentActionPolicy,
} from "@agenticx/config";
import { enterpriseDesktopAgentPolicies as pgPolicyTable } from "@agenticx/db-schema";
import { enterpriseDesktopAgentPolicies as mysqlPolicyTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

export type { DesktopAgentActionPolicy };
export { DEFAULT_DESKTOP_AGENT_ACTION_POLICY, normalizeDesktopAgentActionPolicy };

function isMissingPolicyTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /enterprise_desktop_agent_policies|relation ["'`].*["'`] does not exist|ER_NO_SUCH_TABLE|doesn't exist/i.test(
    message,
  );
}

async function readPolicyConfig(tenantId: string): Promise<unknown | null> {
  const database = resolveDatabaseConfig();
  if (database.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(database);
    const rows = await db
      .select({ config: mysqlPolicyTable.config })
      .from(mysqlPolicyTable)
      .where(eq(mysqlPolicyTable.tenantId, tenantId))
      .limit(1);
    return rows[0]?.config ?? null;
  }

  const db = getIamDb();
  const rows = await db
    .select({ config: pgPolicyTable.config })
    .from(pgPolicyTable)
    .where(eq(pgPolicyTable.tenantId, tenantId))
    .limit(1);
  return rows[0]?.config ?? null;
}

export async function loadDesktopAgentPolicy(tenantId: string): Promise<DesktopAgentActionPolicy> {
  const tid = tenantId.trim();
  if (!tid || !process.env.DATABASE_URL?.trim()) {
    console.warn("[desktop-agent-policy] no tenant or database; using defaults");
    return {
      deniedTools: [],
      alwaysAskTools: [],
      disableSessionAllow: false,
    };
  }

  try {
    const config = await readPolicyConfig(tid);
    if (config == null) {
      console.warn("[desktop-agent-policy] no policy row; using defaults");
      return {
        deniedTools: [],
        alwaysAskTools: [],
        disableSessionAllow: false,
      };
    }
    return normalizeDesktopAgentActionPolicy(config);
  } catch (error) {
    if (isMissingPolicyTable(error)) {
      console.warn("[desktop-agent-policy] policy table missing; using defaults", error);
      return {
        deniedTools: [],
        alwaysAskTools: [],
        disableSessionAllow: false,
      };
    }
    throw error;
  }
}

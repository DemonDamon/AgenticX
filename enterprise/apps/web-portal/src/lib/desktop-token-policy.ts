import { enterpriseRuntimeBudgets as pgBudgetTable } from "@agenticx/db-schema";
import { enterpriseRuntimeBudgets as mysqlBudgetTable } from "@agenticx/db-schema/mysql";
import {
  DEFAULT_DESKTOP_CAPABILITY_POLICY,
  DEFAULT_SESSION_TOKEN_LIMITS,
  normalizeDesktopCapabilityPolicy,
  normalizeSessionTokenLimits,
  type DesktopCapabilityPolicy,
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

/**
 * 读取该租户的托管策略原始配置。
 *
 * 会话额度和「能不能自己装东西」都躺在同一列 JSON 里，读一次就够——bootstrap 每次
 * 都要这两样，分两个函数各查一遍库是白跑。
 */
async function readBudgetConfig(tenantId: string): Promise<unknown> {
  const tid = tenantId.trim();
  if (!tid || !process.env.DATABASE_URL?.trim()) return null;

  const database = resolveDatabaseConfig();
  if (database.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(database);
    const rows = await db
      .select({ config: mysqlBudgetTable.config })
      .from(mysqlBudgetTable)
      .where(eq(mysqlBudgetTable.tenantId, tid))
      .limit(1);
    return rows[0]?.config ?? null;
  }

  const db = getIamDb();
  const rows = await db
    .select({ config: pgBudgetTable.config })
    .from(pgBudgetTable)
    .where(eq(pgBudgetTable.tenantId, tid))
    .limit(1);
  return rows[0]?.config ?? null;
}

export type DesktopManagedPolicy = {
  tokenLimits: SessionTokenLimits;
  capabilities: DesktopCapabilityPolicy;
};

function policyFromConfig(config: unknown): DesktopManagedPolicy {
  const source =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return {
    tokenLimits: limitsFromConfig(config),
    capabilities: normalizeDesktopCapabilityPolicy(source.desktopCapabilityPolicy),
  };
}

/** Load the managed Desktop policy for the tenant authenticated by the PAT. */
export async function loadDesktopManagedPolicy(tenantId: string): Promise<DesktopManagedPolicy> {
  try {
    return policyFromConfig(await readBudgetConfig(tenantId));
  } catch (error) {
    // This policy augments the authenticated bootstrap response. A database
    // that has not run the budget-table migration yet, or a transient policy
    // read failure, must not make enterprise sign-in unusable.
    //
    // 这里的失败方向和网关的撤销判定相反，是有意的：读不到策略就按「没配过」走，
    // 也就是维持原样。往锁死那一侧兜底会让一次数据库抖动变成全员装不了东西。
    console.warn(
      "[desktop-token-policy] managed policy unavailable; using defaults",
      error,
    );
    return {
      tokenLimits: { ...DEFAULT_SESSION_TOKEN_LIMITS },
      capabilities: { ...DEFAULT_DESKTOP_CAPABILITY_POLICY },
    };
  }
}

export async function loadDesktopSessionTokenLimits(
  tenantId: string,
): Promise<SessionTokenLimits> {
  return (await loadDesktopManagedPolicy(tenantId)).tokenLimits;
}

import { enterpriseRuntimeBudgets as pgBudgetTable } from "@agenticx/db-schema";
import { enterpriseRuntimeBudgets as mysqlBudgetTable } from "@agenticx/db-schema/mysql";
import {
  createMysqlDb,
  getIamDb,
  resolveDatabaseConfig,
} from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

export type SessionTokenLimits = {
  warningTokensPerSession: number;
  maxTokensPerSession: number;
};

export type DesktopCapabilityPolicy = {
  allowLocalSkillInstall: boolean;
  allowLocalMcpInstall: boolean;
  allowMcpAutoDiscovery: boolean;
};

export const DEFAULT_SESSION_TOKEN_LIMITS: SessionTokenLimits = {
  warningTokensPerSession: 500_000,
  maxTokensPerSession: 1_000_000,
};

export const DEFAULT_DESKTOP_CAPABILITY_POLICY: DesktopCapabilityPolicy = {
  allowLocalSkillInstall: true,
  allowLocalMcpInstall: true,
  allowMcpAutoDiscovery: true,
};

const MIN_SESSION_WARNING_TOKENS = 50_000;
const MIN_SESSION_MAX_TOKENS = 100_000;
const MAX_SESSION_TOKENS = 5_000_000;

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function normalizeSessionTokenLimits(value: unknown): SessionTokenLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  }
  const row = value as Record<string, unknown>;
  if (
    !isIntegerInRange(row.warningTokensPerSession, MIN_SESSION_WARNING_TOKENS, MAX_SESSION_TOKENS - 1) ||
    !isIntegerInRange(row.maxTokensPerSession, MIN_SESSION_MAX_TOKENS, MAX_SESSION_TOKENS) ||
    row.warningTokensPerSession >= row.maxTokensPerSession
  ) {
    return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  }
  return {
    warningTokensPerSession: row.warningTokensPerSession,
    maxTokensPerSession: row.maxTokensPerSession,
  };
}

function readFlag(source: Record<string, unknown>, key: keyof DesktopCapabilityPolicy): boolean {
  const value = source[key];
  return value === false ? false : DEFAULT_DESKTOP_CAPABILITY_POLICY[key];
}

export function normalizeDesktopCapabilityPolicy(raw: unknown): DesktopCapabilityPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_DESKTOP_CAPABILITY_POLICY };
  }
  const source = raw as Record<string, unknown>;
  return {
    allowLocalSkillInstall: readFlag(source, "allowLocalSkillInstall"),
    allowLocalMcpInstall: readFlag(source, "allowLocalMcpInstall"),
    allowMcpAutoDiscovery: readFlag(source, "allowMcpAutoDiscovery"),
  };
}

function limitsFromConfig(config: unknown): SessionTokenLimits {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  }
  return normalizeSessionTokenLimits((config as Record<string, unknown>).sessionTokenLimits);
}

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

export async function loadDesktopManagedPolicy(tenantId: string): Promise<DesktopManagedPolicy> {
  try {
    return policyFromConfig(await readBudgetConfig(tenantId));
  } catch (error) {
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

import { enterpriseRuntimeTokenQuotas as qTable, gatewayQuotaPoolUsage } from "@agenticx/db-schema";
import * as fs from "node:fs";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { getIamDb } from "./db";

export type QuotaUsageScope = "tenant" | "dept" | "user" | "pat";

export type QuotaRuleSnapshot = {
  monthlyTokens: number;
  poolScope?: "" | "dept" | "tenant";
  action?: string;
};

export type QuotaConfigSnapshot = {
  defaults: {
    role: Record<string, QuotaRuleSnapshot>;
    model: Record<string, QuotaRuleSnapshot>;
  };
  users: Record<string, QuotaRuleSnapshot>;
  departments: Record<string, QuotaRuleSnapshot>;
  apiTokens?: Record<string, QuotaRuleSnapshot>;
};

export type RemainingUsage = {
  scope: QuotaUsageScope;
  scopeId: string;
  period: string;
  used: number;
  limit: number;
  remaining: number | null;
  unlimited: boolean;
  shared?: boolean;
};

type UsageRow = { user_id: string; month: string; used_total: number };

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function requiredTenant(explicit?: string): string {
  const t = (explicit ?? process.env.DEFAULT_TENANT_ID)?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for quota usage.");
  return t;
}

export function resolveRuntimeGatewayDir(cwd = process.cwd()): string {
  const fromEnv = process.env.ENTERPRISE_GATEWAY_RUNTIME_DIR?.trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    path.resolve(cwd, ".runtime/gateway"),
    path.resolve(cwd, "../../.runtime/gateway"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function readUserUsageFile(): UsageRow[] {
  const usagePath =
    process.env.GATEWAY_QUOTA_USAGE_FILE?.trim() ||
    path.join(resolveRuntimeGatewayDir(), "quota-usage.json");
  if (!fs.existsSync(usagePath)) return [];
  try {
    const raw = fs.readFileSync(usagePath, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as UsageRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readUserUsed(userId: string, period: string): number {
  const rows = readUserUsageFile();
  for (const row of rows) {
    if (row.user_id === userId && row.month === period) {
      return Number(row.used_total) || 0;
    }
  }
  return 0;
}

async function readPoolUsed(
  tenantId: string,
  scopeType: "dept" | "tenant",
  scopeId: string,
  period: string,
): Promise<number> {
  if (!process.env.DATABASE_URL?.trim()) {
    return readLocalPoolUsed(tenantId, scopeType, scopeId, period);
  }
  try {
    const db = getIamDb();
    const row = await db
      .select({ usedTotal: gatewayQuotaPoolUsage.usedTotal })
      .from(gatewayQuotaPoolUsage)
      .where(
        and(
          eq(gatewayQuotaPoolUsage.tenantId, tenantId),
          eq(gatewayQuotaPoolUsage.scopeType, scopeType),
          eq(gatewayQuotaPoolUsage.scopeId, scopeId),
          eq(gatewayQuotaPoolUsage.period, period),
        ),
      )
      .limit(1);
    return row[0]?.usedTotal ?? 0;
  } catch {
    return readLocalPoolUsed(tenantId, scopeType, scopeId, period);
  }
}

type PoolUsageRow = {
  tenant_id: string;
  scope_type: string;
  scope_id: string;
  period: string;
  used_total: number;
};

function readLocalPoolUsed(
  tenantId: string,
  scopeType: string,
  scopeId: string,
  period: string,
): number {
  const poolPath =
    process.env.GATEWAY_QUOTA_POOL_USAGE_FILE?.trim() ||
    path.join(resolveRuntimeGatewayDir(), "quota-pool-usage.json");
  if (!fs.existsSync(poolPath)) return 0;
  try {
    const rows = JSON.parse(fs.readFileSync(poolPath, "utf-8")) as PoolUsageRow[];
    if (!Array.isArray(rows)) return 0;
    for (const row of rows) {
      if (
        row.tenant_id === tenantId &&
        row.scope_type === scopeType &&
        row.scope_id === scopeId &&
        row.period === period
      ) {
        return Number(row.used_total) || 0;
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

function normalizeRule(input: Partial<QuotaRuleSnapshot> | undefined): QuotaRuleSnapshot {
  const monthlyTokens = Number(input?.monthlyTokens ?? 0);
  const poolScopeRaw = String(input?.poolScope ?? "").trim();
  const poolScope =
    poolScopeRaw === "dept" || poolScopeRaw === "tenant" ? poolScopeRaw : ("" as const);
  return {
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    poolScope,
    action: input?.action,
  };
}

function normalizeConfig(input: Partial<QuotaConfigSnapshot> | undefined): QuotaConfigSnapshot {
  const next: QuotaConfigSnapshot = {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    apiTokens: {},
  };
  for (const [key, value] of Object.entries(input?.defaults?.role ?? {})) {
    next.defaults.role[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.defaults?.model ?? {})) {
    next.defaults.model[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.users ?? {})) {
    next.users[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.departments ?? {})) {
    next.departments[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.apiTokens ?? {})) {
    next.apiTokens![key] = normalizeRule(value);
  }
  return next;
}

export async function loadQuotaConfigSnapshot(tenantId?: string): Promise<QuotaConfigSnapshot> {
  const tid = requiredTenant(tenantId);
  const db = getIamDb();
  const row = await db.select().from(qTable).where(eq(qTable.tenantId, tid)).limit(1);
  if (!row.length) {
    return normalizeConfig(undefined);
  }
  return normalizeConfig(row[0]?.config as Partial<QuotaConfigSnapshot>);
}

function findTenantPoolRule(cfg: QuotaConfigSnapshot): QuotaRuleSnapshot | null {
  for (const rule of Object.values(cfg.defaults.role)) {
    if (rule.poolScope === "tenant" && rule.monthlyTokens > 0) return rule;
  }
  for (const rule of Object.values(cfg.departments)) {
    if (rule.poolScope === "tenant" && rule.monthlyTokens > 0) return rule;
  }
  for (const rule of Object.values(cfg.users)) {
    if (rule.poolScope === "tenant" && rule.monthlyTokens > 0) return rule;
  }
  return null;
}

function selectRuleExtended(
  cfg: QuotaConfigSnapshot,
  ctx: { userId?: string; deptId?: string | null; role?: string; model?: string; apiTokenId?: string },
): QuotaRuleSnapshot {
  if (ctx.apiTokenId && cfg.apiTokens?.[ctx.apiTokenId]) {
    return normalizeRule(cfg.apiTokens[ctx.apiTokenId]);
  }
  if (ctx.userId && cfg.users[ctx.userId]) {
    return normalizeRule(cfg.users[ctx.userId]);
  }
  if (ctx.deptId && cfg.departments[ctx.deptId]) {
    return normalizeRule(cfg.departments[ctx.deptId]);
  }
  if (ctx.model && cfg.defaults.model[ctx.model]) {
    return normalizeRule(cfg.defaults.model[ctx.model]);
  }
  if (ctx.role && cfg.defaults.role[ctx.role]) {
    return normalizeRule(cfg.defaults.role[ctx.role]);
  }
  if (cfg.defaults.role.staff) {
    return normalizeRule(cfg.defaults.role.staff);
  }
  return normalizeRule(undefined);
}

/** User-visible row: personal rule chain without department fallback. */
function selectUserVisibleRule(
  cfg: QuotaConfigSnapshot,
  ctx: { userId?: string; role?: string; model?: string; apiTokenId?: string },
): QuotaRuleSnapshot {
  if (ctx.apiTokenId && cfg.apiTokens?.[ctx.apiTokenId]) {
    return normalizeRule(cfg.apiTokens[ctx.apiTokenId]);
  }
  if (ctx.userId && cfg.users[ctx.userId]) {
    return normalizeRule(cfg.users[ctx.userId]);
  }
  if (ctx.model && cfg.defaults.model[ctx.model]) {
    return normalizeRule(cfg.defaults.model[ctx.model]);
  }
  if (ctx.role && cfg.defaults.role[ctx.role]) {
    return normalizeRule(cfg.defaults.role[ctx.role]);
  }
  if (cfg.defaults.role.staff) {
    return normalizeRule(cfg.defaults.role.staff);
  }
  return normalizeRule(undefined);
}

function ruleForScope(
  cfg: QuotaConfigSnapshot,
  scope: QuotaUsageScope,
  scopeId: string,
  tenantId: string,
  ctx: { deptId?: string | null; role?: string; model?: string },
): QuotaRuleSnapshot {
  switch (scope) {
    case "pat":
      return normalizeRule(cfg.apiTokens?.[scopeId]);
    case "user":
      if (cfg.users[scopeId]) return normalizeRule(cfg.users[scopeId]);
      return selectRuleExtended(cfg, { userId: scopeId, deptId: ctx.deptId, role: ctx.role });
    case "dept":
      return normalizeRule(cfg.departments[scopeId]);
    case "tenant": {
      const tenantRule = findTenantPoolRule(cfg);
      return tenantRule ?? normalizeRule(undefined);
    }
    default:
      return normalizeRule(undefined);
  }
}

function buildRemaining(
  scope: QuotaUsageScope,
  scopeId: string,
  period: string,
  used: number,
  rule: QuotaRuleSnapshot,
  shared: boolean,
): RemainingUsage {
  if (rule.monthlyTokens <= 0) {
    return {
      scope,
      scopeId,
      period,
      used,
      limit: 0,
      remaining: null,
      unlimited: true,
      shared: shared || undefined,
    };
  }
  const remaining = Math.max(rule.monthlyTokens - used, 0);
  return {
    scope,
    scopeId,
    period,
    used,
    limit: rule.monthlyTokens,
    remaining,
    unlimited: false,
    shared: shared || undefined,
  };
}

async function readUsedForRule(
  tenantId: string,
  rule: QuotaRuleSnapshot,
  ctx: { userId: string; deptId?: string | null },
  period: string,
): Promise<{ used: number; shared: boolean }> {
  const poolScope = rule.poolScope ?? "";
  if (poolScope === "dept" && ctx.deptId) {
    const used = await readPoolUsed(tenantId, "dept", ctx.deptId, period);
    return { used, shared: true };
  }
  if (poolScope === "tenant") {
    const used = await readPoolUsed(tenantId, "tenant", tenantId, period);
    return { used, shared: true };
  }
  return { used: readUserUsed(ctx.userId, period), shared: false };
}

export async function getQuotaUsageForScope(input: {
  tenantId?: string;
  scope: QuotaUsageScope;
  scopeId: string;
  deptId?: string | null;
  role?: string;
  userIdForPat?: string;
  /** Test-only override to avoid PG in unit tests. */
  configOverride?: QuotaConfigSnapshot;
}): Promise<RemainingUsage> {
  const tenantId = requiredTenant(input.tenantId);
  const period = currentPeriod();
  const cfg = input.configOverride ?? (await loadQuotaConfigSnapshot(tenantId));
  const rule = ruleForScope(cfg, input.scope, input.scopeId, tenantId, {
    deptId: input.deptId,
    role: input.role,
  });

  if (input.scope === "dept") {
    const deptRule = normalizeRule(cfg.departments[input.scopeId]);
    if (deptRule.poolScope === "dept") {
      const used = await readPoolUsed(tenantId, "dept", input.scopeId, period);
      return buildRemaining("dept", input.scopeId, period, used, deptRule, true);
    }
    return buildRemaining("dept", input.scopeId, period, 0, deptRule, false);
  }

  if (input.scope === "tenant") {
    const used = await readPoolUsed(tenantId, "tenant", tenantId, period);
    return buildRemaining("tenant", tenantId, period, used, rule, rule.poolScope === "tenant");
  }

  if (input.scope === "pat") {
    const userId = input.userIdForPat ?? "";
    const { used } = await readUsedForRule(tenantId, rule, { userId, deptId: input.deptId }, period);
    return buildRemaining("pat", input.scopeId, period, used, rule, false);
  }

  const userId = input.scopeId;
  const effectiveRule = selectUserVisibleRule(cfg, {
    userId,
    role: input.role,
  });
  const queryCtx = { userId, deptId: input.deptId };
  const { used, shared } = await readUsedForRule(tenantId, effectiveRule, queryCtx, period);
  return buildRemaining("user", userId, period, used, effectiveRule, shared);
}

export type QuotaSummary = {
  user: RemainingUsage;
  dept: RemainingUsage | null;
  unlimited: boolean;
};

/** Portal: current user + their department only (no arbitrary id override). */
export async function getQuotaSummaryForSession(input: {
  tenantId: string;
  userId: string;
  deptId?: string | null;
  role?: string;
  configOverride?: QuotaConfigSnapshot;
}): Promise<QuotaSummary> {
  const user = await getQuotaUsageForScope({
    tenantId: input.tenantId,
    scope: "user",
    scopeId: input.userId,
    deptId: input.deptId,
    role: input.role,
    configOverride: input.configOverride,
  });
  let dept: RemainingUsage | null = null;
  if (input.deptId) {
    dept = await getQuotaUsageForScope({
      tenantId: input.tenantId,
      scope: "dept",
      scopeId: input.deptId,
      deptId: input.deptId,
      role: input.role,
      configOverride: input.configOverride,
    });
  }
  const unlimited = user.unlimited && (!dept || dept.unlimited);
  return { user, dept, unlimited };
}

import { enterpriseRuntimeTokenQuotas as qTable, gatewayQuotaPoolUsage, usageRecords as pgUsageRecords } from "@agenticx/db-schema";
import { usageRecords as mysqlUsageRecords } from "@agenticx/db-schema/mysql";
import * as fs from "node:fs";
import * as path from "node:path";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { createMysqlDb, getIamDb } from "./db";
import { resolveDatabaseConfig } from "./database/config";
import { loadMysqlQuotaConfig, readMysqlQuotaUsage } from "./repos/mysql/quota";

export type QuotaUsageScope = "tenant" | "dept" | "user" | "pat";

export type QuotaRuleSnapshot = {
  monthlyTokens: number;
  dailyTokens?: number;
  weeklyTokens?: number;
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

export type QuotaWindow = "day" | "week" | "month";

function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentDayPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function currentWeekPeriod(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function periodForWindow(window: QuotaWindow, now = new Date()): string {
  if (window === "day") return currentDayPeriod(now);
  if (window === "week") return currentWeekPeriod(now);
  return currentPeriod(now);
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
    if (resolveDatabaseConfig().dialect === "mysql") {
      return await readMysqlQuotaUsage(tenantId, scopeType, scopeId, period);
    }
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

async function readTokenWindowUsed(
  tenantId: string,
  scopeType: "tok_day" | "tok_week",
  scopeId: string,
  period: string,
): Promise<number> {
  if (!process.env.DATABASE_URL?.trim()) {
    return readLocalPoolUsed(tenantId, scopeType, scopeId, period);
  }
  try {
    if (resolveDatabaseConfig().dialect === "mysql") {
      return await readMysqlQuotaUsage(tenantId, scopeType, scopeId, period);
    }
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
  const dailyTokens = Number(input?.dailyTokens ?? 0);
  const weeklyTokens = Number(input?.weeklyTokens ?? 0);
  const poolScopeRaw = String(input?.poolScope ?? "").trim();
  const poolScope =
    poolScopeRaw === "dept" || poolScopeRaw === "tenant" ? poolScopeRaw : ("" as const);
  return {
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    dailyTokens: Number.isFinite(dailyTokens) && dailyTokens > 0 ? Math.floor(dailyTokens) : 0,
    weeklyTokens: Number.isFinite(weeklyTokens) && weeklyTokens > 0 ? Math.floor(weeklyTokens) : 0,
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
  if (resolveDatabaseConfig().dialect === "mysql") {
    const config = await loadMysqlQuotaConfig(tid);
    return normalizeConfig(config as Partial<QuotaConfigSnapshot> | undefined);
  }
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
  limit: number,
  shared: boolean,
): RemainingUsage {
  if (limit <= 0) {
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
  const remaining = Math.max(limit - used, 0);
  return {
    scope,
    scopeId,
    period,
    used,
    limit,
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

function limitForWindow(rule: QuotaRuleSnapshot, window: QuotaWindow): number {
  if (window === "day") return rule.dailyTokens ?? 0;
  if (window === "week") return rule.weeklyTokens ?? 0;
  return rule.monthlyTokens;
}

function tokenWindowScopeType(window: QuotaWindow): "tok_day" | "tok_week" {
  return window === "day" ? "tok_day" : "tok_week";
}

/**
 * Mirrors gateway `rateKey("tok", ctx)` identity (without the `tok::` prefix).
 * Day/week token windows are tracked per request identity, not via `rule.poolScope` shared pools.
 */
export function tokenWindowIdentity(ctx: {
  apiTokenId?: string;
  userId?: string;
  deptId?: string | null;
  tenantId: string;
}): string {
  if (ctx.apiTokenId?.trim()) return `pat::${ctx.apiTokenId.trim()}`;
  if (ctx.userId?.trim()) return `user::${ctx.userId.trim()}`;
  if (ctx.deptId?.trim()) return `dept::${ctx.deptId.trim()}`;
  return `tenant::${ctx.tenantId.trim()}`;
}

/** Day/week usage reads only apply to user/pat scopes; dept/tenant have no separate tok_day/tok_week pool keys. */
function tokenWindowUsageSupported(scope: QuotaUsageScope): boolean {
  return scope === "user" || scope === "pat";
}

export async function getQuotaWindowUsageForScope(input: {
  tenantId?: string;
  scope: QuotaUsageScope;
  scopeId: string;
  window: QuotaWindow;
  deptId?: string | null;
  role?: string;
  userIdForPat?: string;
  /** Test-only override to avoid PG in unit tests. */
  configOverride?: QuotaConfigSnapshot;
}): Promise<RemainingUsage> {
  const tenantId = requiredTenant(input.tenantId);
  const period = periodForWindow(input.window);
  const cfg = input.configOverride ?? (await loadQuotaConfigSnapshot(tenantId));
  const rule = ruleForScope(cfg, input.scope, input.scopeId, tenantId, {
    deptId: input.deptId,
    role: input.role,
  });

  const limit = limitForWindow(rule, input.window);

  if (input.window !== "month") {
    let used = 0;
    if (tokenWindowUsageSupported(input.scope)) {
      const identity = tokenWindowIdentity({
        apiTokenId: input.scope === "pat" ? input.scopeId : undefined,
        userId: input.scope === "user" ? input.scopeId : (input.userIdForPat ?? ""),
        deptId: input.deptId,
        tenantId,
      });
      used = await readTokenWindowUsed(
        tenantId,
        tokenWindowScopeType(input.window),
        identity,
        period,
      );
    }
    // dept/tenant: gateway enforces day/week per identity only; dept::/tenant:: pool keys are not written.
    return buildRemaining(input.scope, input.scopeId, period, used, limit, false);
  }

  if (input.scope === "dept") {
    const deptRule = normalizeRule(cfg.departments[input.scopeId]);
    if (deptRule.poolScope === "dept") {
      const used = await readPoolUsed(tenantId, "dept", input.scopeId, period);
      return buildRemaining("dept", input.scopeId, period, used, limit, true);
    }
    return buildRemaining("dept", input.scopeId, period, 0, limit, false);
  }

  if (input.scope === "tenant") {
    const used = await readPoolUsed(tenantId, "tenant", tenantId, period);
    return buildRemaining("tenant", tenantId, period, used, limit, rule.poolScope === "tenant");
  }

  if (input.scope === "pat") {
    const userId = input.userIdForPat ?? "";
    const { used } = await readUsedForRule(tenantId, rule, { userId, deptId: input.deptId }, period);
    return buildRemaining("pat", input.scopeId, period, used, limit, false);
  }

  const userId = input.scopeId;
  const effectiveRule = selectUserVisibleRule(cfg, {
    userId,
    role: input.role,
  });
  const queryCtx = { userId, deptId: input.deptId };
  const { used, shared } = await readUsedForRule(tenantId, effectiveRule, queryCtx, period);
  return buildRemaining("user", userId, period, used, limitForWindow(effectiveRule, "month"), shared);
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
  return getQuotaWindowUsageForScope({ ...input, window: "month" });
}

export type QuotaSummary = {
  daily: RemainingUsage;
  weekly: RemainingUsage;
  monthly: RemainingUsage;
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
  const tenantId = input.tenantId;
  const cfg = input.configOverride ?? (await loadQuotaConfigSnapshot(tenantId));
  const base = {
    tenantId,
    deptId: input.deptId,
    role: input.role,
    configOverride: cfg,
  };

  const [daily, weekly, monthly, dept] = await Promise.all([
    getQuotaWindowUsageForScope({ ...base, scope: "user", scopeId: input.userId, window: "day" }),
    getQuotaWindowUsageForScope({ ...base, scope: "user", scopeId: input.userId, window: "week" }),
    getQuotaWindowUsageForScope({ ...base, scope: "user", scopeId: input.userId, window: "month" }),
    input.deptId
      ? getQuotaUsageForScope({ ...base, scope: "dept", scopeId: input.deptId })
      : Promise.resolve(null),
  ]);

  const user = monthly;
  const unlimited = monthly.unlimited && daily.unlimited && weekly.unlimited && (!dept || dept.unlimited);
  return { daily, weekly, monthly, user, dept, unlimited };
}

/** One usage_records row, or a test fixture with the same columns. */
export type UsageRecordSlice = {
  userId: string;
  timeBucket: string | Date;
  totalTokens: number;
  costUsd: number;
};

/** Token and cost totals for one member in one calendar window. */
export type QuotaWindowUsageTotals = {
  userId: string;
  window: QuotaWindow;
  period: string;
  tokens: number;
  costUsd: number;
};

const QUOTA_WINDOWS: readonly QuotaWindow[] = ["day", "week", "month"];
const USAGE_QUERY_CHUNK = 100;

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcWeekStart(now: Date): Date {
  const start = utcDayStart(now);
  const weekday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - weekday);
  return start;
}

function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function usageWindowStart(window: QuotaWindow, now = new Date()): Date {
  if (window === "day") return utcDayStart(now);
  if (window === "week") return utcWeekStart(now);
  return utcMonthStart(now);
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fold usage_records rows into per-user day / week / month totals.
 * A row counts toward every requested window that contains its time_bucket.
 */
export function foldUsageRecordSlices(input: {
  userIds: readonly string[];
  windows: readonly QuotaWindow[];
  rows: readonly UsageRecordSlice[];
  now?: Date;
}): QuotaWindowUsageTotals[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const starts = new Map(input.windows.map((window) => [window, usageWindowStart(window, now).getTime()]));
  const totals = new Map<string, { tokens: number; costUsd: number }>();
  for (const row of input.rows) {
    const userId = row.userId?.trim();
    if (!userId) continue;
    const at = row.timeBucket instanceof Date ? row.timeBucket.getTime() : new Date(row.timeBucket).getTime();
    if (!Number.isFinite(at) || at > nowMs) continue;
    for (const window of input.windows) {
      if (at < (starts.get(window) ?? 0)) continue;
      const key = `${userId}\0${window}`;
      const current = totals.get(key) ?? { tokens: 0, costUsd: 0 };
      current.tokens += finiteNumber(row.totalTokens);
      current.costUsd += finiteNumber(row.costUsd);
      totals.set(key, current);
    }
  }
  return input.userIds.flatMap((userId) => input.windows.map((window) => {
    const spent = totals.get(`${userId}\0${window}`);
    return {
      userId,
      window,
      period: periodForWindow(window, now),
      tokens: spent?.tokens ?? 0,
      costUsd: spent?.costUsd ?? 0,
    };
  }));
}

type UsageAggregateRow = {
  userId: string | null;
  dayTokens: unknown;
  dayCost: unknown;
  weekTokens: unknown;
  weekCost: unknown;
  monthTokens: unknown;
  monthCost: unknown;
};

function asAggregate(row: UsageAggregateRow): UsageAggregateRow {
  return row;
}

function totalsFromAggregates(
  userIds: readonly string[],
  windows: readonly QuotaWindow[],
  rows: readonly UsageAggregateRow[],
  now: Date,
): QuotaWindowUsageTotals[] {
  const byUser = new Map<string, UsageAggregateRow>();
  for (const row of rows) {
    const userId = row.userId?.trim();
    if (userId) byUser.set(userId, row);
  }
  return userIds.flatMap((userId) => windows.map((window) => {
    const row = byUser.get(userId);
    const tokens = window === "day" ? row?.dayTokens : window === "week" ? row?.weekTokens : row?.monthTokens;
    const cost = window === "day" ? row?.dayCost : window === "week" ? row?.weekCost : row?.monthCost;
    return {
      userId,
      window,
      period: periodForWindow(window, now),
      tokens: finiteNumber(tokens),
      costUsd: finiteNumber(cost),
    };
  }));
}

async function readUsageAggregates(tenantId: string, userIds: readonly string[], now: Date): Promise<UsageAggregateRow[]> {
  const bounds: Record<QuotaWindow, Date> = {
    day: usageWindowStart("day", now),
    week: usageWindowStart("week", now),
    month: usageWindowStart("month", now),
  };
  const rows: UsageAggregateRow[] = [];
  const config = resolveDatabaseConfig();
  for (let offset = 0; offset < userIds.length; offset += USAGE_QUERY_CHUNK) {
    const chunk = userIds.slice(offset, offset + USAGE_QUERY_CHUNK);
    if (config.dialect === "mysql") {
      const table = mysqlUsageRecords;
      const since = (start: Date, column: typeof table.totalTokens | typeof table.costUsd) =>
        sql<string>`coalesce(sum(case when ${table.timeBucket} >= ${start} then ${column} else 0 end), 0)`;
      const { raw } = await createMysqlDb(config);
      const selected = await raw
        .select({
          userId: table.userId,
          dayTokens: since(bounds.day, table.totalTokens),
          dayCost: since(bounds.day, table.costUsd),
          weekTokens: since(bounds.week, table.totalTokens),
          weekCost: since(bounds.week, table.costUsd),
          monthTokens: since(bounds.month, table.totalTokens),
          monthCost: since(bounds.month, table.costUsd),
        })
        .from(table)
        .where(and(
          eq(table.tenantId, tenantId),
          inArray(table.userId, chunk),
          gte(table.timeBucket, bounds.month),
        ))
        .groupBy(table.userId);
      rows.push(...selected.map(asAggregate));
      continue;
    }
    const table = pgUsageRecords;
    const since = (start: Date, column: typeof table.totalTokens | typeof table.costUsd) =>
      sql<string>`coalesce(sum(case when ${table.timeBucket} >= ${start} then ${column} else 0 end), 0)`;
    const selected = await getIamDb()
      .select({
        userId: table.userId,
        dayTokens: since(bounds.day, table.totalTokens),
        dayCost: since(bounds.day, table.costUsd),
        weekTokens: since(bounds.week, table.totalTokens),
        weekCost: since(bounds.week, table.costUsd),
        monthTokens: since(bounds.month, table.totalTokens),
        monthCost: since(bounds.month, table.costUsd),
      })
      .from(table)
      .where(and(
        eq(table.tenantId, tenantId),
        inArray(table.userId, chunk),
        gte(table.timeBucket, bounds.month),
      ))
      .groupBy(table.userId);
    rows.push(...selected.map(asAggregate));
  }
  return rows;
}

/**
 * Token and cost usage for many members across day / week / month windows.
 * One grouped read of usage_records per dialect; an empty member list reads nothing.
 */
export async function getQuotaWindowUsagesForUsers(input: {
  tenantId: string;
  userIds: readonly string[];
  windows?: readonly QuotaWindow[];
  now?: Date;
  /** Test fixture. Skips the database and folds these usage_records rows. */
  recordsOverride?: readonly UsageRecordSlice[];
}): Promise<QuotaWindowUsageTotals[]> {
  const userIds = [...new Set(input.userIds.map((id) => id.trim()).filter(Boolean))];
  const windows = input.windows ?? QUOTA_WINDOWS;
  if (userIds.length === 0 || windows.length === 0) return [];
  const now = input.now ?? new Date();
  if (input.recordsOverride) return foldUsageRecordSlices({ userIds, windows, rows: input.recordsOverride, now });
  if (!process.env.DATABASE_URL?.trim()) return foldUsageRecordSlices({ userIds, windows, rows: [], now });
  return totalsFromAggregates(userIds, windows, await readUsageAggregates(input.tenantId, userIds, now), now);
}

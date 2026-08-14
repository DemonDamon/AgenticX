/**
 * Tenant-wide daily hard cap on outbound web-search provider calls.
 *
 * Ordinary search and deep research share one gate. Reservation is a single
 * conditional UPDATE that both rolls the UTC day over and increments the
 * counter, so concurrent instances can never oversell the limit.
 */

import { enterpriseWebSearchDailyQuota as pgTable } from "@agenticx/db-schema";
import { enterpriseWebSearchDailyQuota as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { and, eq, sql } from "drizzle-orm";

export const MIN_DAILY_SEARCH_PROVIDER_CALLS = 0;
export const MAX_DAILY_SEARCH_PROVIDER_CALLS = 1_000_000;
/** 0 keeps existing tenants running during rollout; admins set a real cap before go-live. */
export const DEFAULT_DAILY_SEARCH_PROVIDER_CALLS = 0;

export const DAILY_SEARCH_PROVIDER_QUOTA_EXHAUSTED_MESSAGE =
  "今日联网搜索额度已用完，请联系管理员调整";
export const DAILY_SEARCH_PROVIDER_QUOTA_UNAVAILABLE_MESSAGE =
  "联网搜索额度校验暂时不可用，请稍后重试";

export type TenantDailySearchProviderQuota = {
  /** UTC calendar day the `used` counter belongs to. */
  usageDay: string;
  limit: number;
  used: number;
  /** null when unlimited. */
  remaining: number | null;
  unlimited: boolean;
};

/**
 * Raised instead of returning false so the admission hook can abort a provider
 * attempt from outside the provider try/catch — a quota block must never be
 * mistaken for a provider failure and trigger failover.
 */
export class TenantDailySearchProviderQuotaError extends Error {
  readonly reason: "exhausted" | "unavailable";
  readonly userMessage: string;

  constructor(reason: "exhausted" | "unavailable", cause?: unknown) {
    const userMessage =
      reason === "exhausted"
        ? DAILY_SEARCH_PROVIDER_QUOTA_EXHAUSTED_MESSAGE
        : DAILY_SEARCH_PROVIDER_QUOTA_UNAVAILABLE_MESSAGE;
    super(`tenant daily web-search provider quota ${reason}`);
    this.name = "TenantDailySearchProviderQuotaError";
    this.reason = reason;
    this.userMessage = userMessage;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isTenantDailySearchProviderQuotaExceeded(
  error: unknown,
): error is TenantDailySearchProviderQuotaError {
  return error instanceof TenantDailySearchProviderQuotaError;
}

export function isValidMaxDailySearchProviderCalls(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_DAILY_SEARCH_PROVIDER_CALLS &&
    value <= MAX_DAILY_SEARCH_PROVIDER_CALLS
  );
}

/** UTC calendar day; the counter resets on the natural UTC day boundary. */
export function utcUsageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) return 0;
  return Math.min(numeric, MAX_DAILY_SEARCH_PROVIDER_CALLS);
}

function normalizeUsed(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function summarize(input: { usageDay: string; limit: number; used: number; today: string }) {
  const limit = normalizeLimit(input.limit);
  // A stale row belongs to a previous UTC day: today's counter starts at zero.
  const used = input.usageDay === input.today ? normalizeUsed(input.used) : 0;
  return {
    usageDay: input.today,
    limit,
    used,
    remaining: limit === 0 ? null : Math.max(0, limit - used),
    unlimited: limit === 0,
  } satisfies TenantDailySearchProviderQuota;
}

type QuotaRow = { limit: number; used: number; usageDay: string };

/**
 * Storage seam. The in-memory implementation is allowed only in an explicit
 * local/test process. Production must fail closed when persistence is missing:
 * otherwise the portal and admin console each get a private unlimited counter.
 */
type QuotaOps = {
  read(tenantId: string): Promise<QuotaRow | null>;
  ensureRow(tenantId: string, today: string, now: Date): Promise<void>;
  setLimit(tenantId: string, limit: number, today: string, now: Date): Promise<void>;
  /** True when the call was admitted and the counter incremented. */
  reserve(tenantId: string, today: string, now: Date): Promise<boolean>;
};

function memoryOps(): QuotaOps {
  const rows = new Map<string, QuotaRow>();
  const rowFor = (tenantId: string, today: string): QuotaRow => {
    const existing = rows.get(tenantId);
    if (existing) return existing;
    const created: QuotaRow = { limit: 0, used: 0, usageDay: today };
    rows.set(tenantId, created);
    return created;
  };
  return {
    async read(tenantId) {
      return rows.get(tenantId) ?? null;
    },
    async ensureRow(tenantId, today) {
      rowFor(tenantId, today);
    },
    async setLimit(tenantId, limit, today) {
      rowFor(tenantId, today).limit = limit;
    },
    async reserve(tenantId, today) {
      const row = rowFor(tenantId, today);
      const used = row.usageDay === today ? row.used : 0;
      if (row.limit !== 0 && used >= row.limit) return false;
      row.usageDay = today;
      row.used = used + 1;
      return true;
    },
  };
}

function pgOps(): QuotaOps {
  return {
    async read(tenantId) {
      const rows = await getIamDb()
        .select({
          limit: pgTable.maxProviderCalls,
          used: pgTable.providerCallsUsed,
          usageDay: pgTable.usageDay,
        })
        .from(pgTable)
        .where(eq(pgTable.tenantId, tenantId))
        .limit(1);
      return rows[0] ?? null;
    },

    async ensureRow(tenantId, today, now) {
      await getIamDb()
        .insert(pgTable)
        .values({
          tenantId,
          maxProviderCalls: 0,
          usageDay: today,
          providerCallsUsed: 0,
          updatedAt: now,
        })
        // No-op on conflict: the row may already carry today's usage.
        .onConflictDoNothing({ target: pgTable.tenantId });
    },

    async setLimit(tenantId, limit, today, now) {
      await getIamDb()
        .insert(pgTable)
        .values({
          tenantId,
          maxProviderCalls: limit,
          usageDay: today,
          providerCallsUsed: 0,
          updatedAt: now,
        })
        // Only the cap moves; today's counter is never cleared by an admin edit.
        .onConflictDoUpdate({
          target: pgTable.tenantId,
          set: { maxProviderCalls: limit, updatedAt: now },
        });
    },

    async reserve(tenantId, today, now) {
      const rows = await getIamDb()
        .update(pgTable)
        .set({
          providerCallsUsed: sql`case when ${pgTable.usageDay} = ${today} then ${pgTable.providerCallsUsed} + 1 else 1 end`,
          usageDay: today,
          updatedAt: now,
        })
        .where(
          and(
            eq(pgTable.tenantId, tenantId),
            sql`(${pgTable.maxProviderCalls} = 0 or case when ${pgTable.usageDay} = ${today} then ${pgTable.providerCallsUsed} else 0 end < ${pgTable.maxProviderCalls})`,
          ),
        )
        .returning({ tenantId: pgTable.tenantId });
      return rows.length > 0;
    },
  };
}

function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const rows = (header as { affectedRows?: unknown } | undefined)?.affectedRows;
  return typeof rows === "number" ? rows : 0;
}

function mysqlOps(config: Extract<ReturnType<typeof resolveDatabaseConfig>, { dialect: "mysql" }>): QuotaOps {
  const db = async () => (await createMysqlDb(config)).raw;
  return {
    async read(tenantId) {
      const rows = await (await db())
        .select({
          limit: mysqlTable.maxProviderCalls,
          used: mysqlTable.providerCallsUsed,
          usageDay: mysqlTable.usageDay,
        })
        .from(mysqlTable)
        .where(eq(mysqlTable.tenantId, tenantId))
        .limit(1);
      return rows[0] ?? null;
    },

    async ensureRow(tenantId, today, now) {
      await (await db())
        .insert(mysqlTable)
        .values({
          tenantId,
          maxProviderCalls: 0,
          usageDay: today,
          providerCallsUsed: 0,
          updatedAt: now,
        })
        // No-op on duplicate: the row may already carry today's usage.
        .onDuplicateKeyUpdate({ set: { tenantId: sql`${mysqlTable.tenantId}` } });
    },

    async setLimit(tenantId, limit, today, now) {
      await (await db())
        .insert(mysqlTable)
        .values({
          tenantId,
          maxProviderCalls: limit,
          usageDay: today,
          providerCallsUsed: 0,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({ set: { maxProviderCalls: limit, updatedAt: now } });
    },

    async reserve(tenantId, today, now) {
      const result = await (await db())
        .update(mysqlTable)
        .set({
          providerCallsUsed: sql`case when ${mysqlTable.usageDay} = ${today} then ${mysqlTable.providerCallsUsed} + 1 else 1 end`,
          usageDay: today,
          updatedAt: now,
        })
        .where(
          and(
            eq(mysqlTable.tenantId, tenantId),
            sql`(${mysqlTable.maxProviderCalls} = 0 or case when ${mysqlTable.usageDay} = ${today} then ${mysqlTable.providerCallsUsed} else 0 end < ${mysqlTable.maxProviderCalls})`,
          ),
        );
      return affectedRows(result) > 0;
    },
  };
}

const IN_MEMORY_QUOTA_OPT_IN = "AGX_ALLOW_IN_MEMORY_SEARCH_QUOTA";

function allowsInMemoryQuota(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "test" || nodeEnv === "development") return true;
  if (nodeEnv === "production") return false;
  return /^(?:1|true)$/iu.test(process.env[IN_MEMORY_QUOTA_OPT_IN]?.trim() ?? "");
}

function unavailableOps(): QuotaOps {
  const fail = async (): Promise<never> => {
    throw new Error(DAILY_SEARCH_PROVIDER_QUOTA_UNAVAILABLE_MESSAGE);
  };
  return {
    read: fail,
    ensureRow: fail,
    setLimit: fail,
    reserve: fail,
  };
}

function resolveOps(): QuotaOps {
  if (!process.env.DATABASE_URL?.trim()) {
    return allowsInMemoryQuota() ? sharedMemoryOps() : unavailableOps();
  }
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysqlOps(config) : pgOps();
}

let memorySingleton: QuotaOps | null = null;
function sharedMemoryOps(): QuotaOps {
  if (!memorySingleton) memorySingleton = memoryOps();
  return memorySingleton;
}

/** Test seam — swap the storage layer without a database. */
let opsOverride: QuotaOps | null = null;
export function __setDailySearchProviderQuotaOpsForTests(ops: QuotaOps | null): void {
  opsOverride = ops;
  if (ops === null) memorySingleton = null;
}
export function __createMemoryDailySearchProviderQuotaOps(): QuotaOps {
  return memoryOps();
}

function ops(): QuotaOps {
  return opsOverride ?? resolveOps();
}

export async function getTenantDailySearchProviderQuota(
  tenantId: string,
  now: Date = new Date(),
): Promise<TenantDailySearchProviderQuota> {
  const today = utcUsageDay(now);
  const row = await ops().read(tenantId);
  if (!row) return summarize({ usageDay: today, limit: 0, used: 0, today });
  return summarize({ usageDay: row.usageDay, limit: row.limit, used: row.used, today });
}

export async function setTenantDailySearchProviderLimit(
  tenantId: string,
  limit: number,
  now: Date = new Date(),
): Promise<TenantDailySearchProviderQuota> {
  if (!isValidMaxDailySearchProviderCalls(limit)) {
    throw new RangeError(
      `maxDailySearchProviderCalls must be an integer between ${MIN_DAILY_SEARCH_PROVIDER_CALLS} and ${MAX_DAILY_SEARCH_PROVIDER_CALLS}`,
    );
  }
  const today = utcUsageDay(now);
  await ops().setLimit(tenantId, limit, today, now);
  return getTenantDailySearchProviderQuota(tenantId, now);
}

/**
 * Reserve exactly one outbound provider call. Throws when the tenant is over
 * its cap, and also when the quota store is unreachable — a gate that cannot be
 * checked must not be assumed open.
 */
export async function reserveTenantDailySearchProviderCall(
  tenantId: string,
  now: Date = new Date(),
): Promise<void> {
  const today = utcUsageDay(now);
  let admitted: boolean;
  try {
    // Resolve the backend inside the guarded block too: malformed production
    // database configuration is a quota outage, not a provider failure that may
    // continue into failover.
    const store = ops();
    await store.ensureRow(tenantId, today, now);
    admitted = await store.reserve(tenantId, today, now);
  } catch (error) {
    console.warn("[web-search] daily provider quota check failed:", error);
    throw new TenantDailySearchProviderQuotaError("unavailable", error);
  }
  if (!admitted) throw new TenantDailySearchProviderQuotaError("exhausted");
}

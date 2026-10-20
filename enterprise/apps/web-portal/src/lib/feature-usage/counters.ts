/**
 * Per-member and shared daily counters for web search and deep research.
 *
 * Personal rows keep the per-member trend. A separate shared row records each
 * company or department pool. Week and month limits sum those daily rows.
 * A reservation checks every configured window, then increments personal,
 * department and company together. A later write failure undoes the earlier
 * increments; a SQL caller also runs this inside one transaction.
 */

import {
  enterpriseFeatureUsageDaily as pgTable,
  enterpriseFeatureUsageSharedDaily as pgSharedTable,
  tenants as pgTenants,
} from "@agenticx/db-schema";
import {
  enterpriseFeatureUsageDaily as mysqlTable,
  enterpriseFeatureUsageSharedDaily as mysqlSharedTable,
  tenants as mysqlTenants,
} from "@agenticx/db-schema/mysql";
import {
  FEATURE_USAGE_WINDOWS,
  combineFeatureUsageStates,
  featureUsageDayRange,
  featureUsageState,
  utcUsageDay,
  type FeatureUsagePolicies,
  type FeatureUsageWindow,
  type MeteredFeature,
} from "@agenticx/config";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { and, eq, gte, lte, sql } from "drizzle-orm";

import { FeatureUsageLimitError, FeatureUsageUnavailableError } from "./errors";

export type FeatureUsageWindowTotals = Record<FeatureUsageWindow, number>;
export type SharedFeatureUsageScope = "company" | "department";

const ZERO_TOTALS: FeatureUsageWindowTotals = { day: 0, week: 0, month: 0 };

type UsageDb = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

export type FeatureUsageCounterOps = {
  /** Serializes reservations for this tenant until the caller releases the lock. */
  lockTenant(tenantId: string): Promise<() => void>;
  sumSince(input: {
    tenantId: string;
    feature: MeteredFeature;
    userId: string;
    fromDay: string;
    toDay: string;
  }): Promise<number>;
  sumSharedSince(input: {
    tenantId: string;
    feature: MeteredFeature;
    scope: SharedFeatureUsageScope;
    scopeId: string;
    fromDay: string;
    toDay: string;
  }): Promise<number>;
  increment(input: {
    tenantId: string;
    feature: MeteredFeature;
    userId: string;
    deptId: string | null;
    usageDay: string;
    delta: number;
    now: Date;
  }): Promise<void>;
  incrementShared(input: {
    tenantId: string;
    feature: MeteredFeature;
    scope: SharedFeatureUsageScope;
    scopeId: string;
    usageDay: string;
    delta: number;
    now: Date;
  }): Promise<void>;
};

function memoryOps(): FeatureUsageCounterOps {
  type MemoryRow = {
    tenantId: string;
    feature: string;
    userId: string;
    usageDay: string;
    deptId: string | null;
    used: number;
  };
  const rows: MemoryRow[] = [];
  type SharedMemoryRow = {
    tenantId: string;
    feature: string;
    scope: SharedFeatureUsageScope;
    scopeId: string;
    usageDay: string;
    used: number;
  };
  const sharedRows: SharedMemoryRow[] = [];
  const tails = new Map<string, Promise<void>>();
  const find = (tenantId: string, feature: string, userId: string, usageDay: string) =>
    rows.find(
      (row) =>
        row.tenantId === tenantId &&
        row.feature === feature &&
        row.userId === userId &&
        row.usageDay === usageDay,
    );
  return {
    async lockTenant(tenantId) {
      const previous = tails.get(tenantId) ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(tenantId, previous.then(() => next));
      await previous;
      return release;
    },
    async sumSince({ tenantId, feature, userId, fromDay, toDay }) {
      return rows
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.feature === feature &&
            row.userId === userId &&
            row.usageDay >= fromDay &&
            row.usageDay <= toDay,
        )
        .reduce((total, row) => total + row.used, 0);
    },
    async sumSharedSince({ tenantId, feature, scope, scopeId, fromDay, toDay }) {
      return sharedRows
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.feature === feature &&
            row.scope === scope &&
            row.scopeId === scopeId &&
            row.usageDay >= fromDay &&
            row.usageDay <= toDay,
        )
        .reduce((total, row) => total + row.used, 0);
    },
    async increment({ tenantId, feature, userId, deptId, usageDay, delta }) {
      const existing = find(tenantId, feature, userId, usageDay);
      if (existing) {
        existing.used += delta;
        existing.deptId = deptId;
        return;
      }
      rows.push({ tenantId, feature, userId, usageDay, deptId, used: delta });
    },
    async incrementShared({ tenantId, feature, scope, scopeId, usageDay, delta }) {
      const row = sharedRows.find(
        (item) =>
          item.tenantId === tenantId &&
          item.feature === feature &&
          item.scope === scope &&
          item.scopeId === scopeId &&
          item.usageDay === usageDay,
      );
      if (row) row.used += delta;
      else sharedRows.push({ tenantId, feature, scope, scopeId, usageDay, used: delta });
    },
  };
}

export function createPgFeatureUsageOps(db: UsageDb): FeatureUsageCounterOps {
  return {
    async lockTenant(tenantId) {
      const rows = await db
        .select({ id: pgTenants.id })
        .from(pgTenants)
        .where(eq(pgTenants.id, tenantId))
        .for("update")
        .limit(1);
      if (rows.length === 0) throw new Error("feature usage tenant not found");
      return () => {};
    },
    async sumSince({ tenantId, feature, userId, fromDay, toDay }) {
      const rows = await db
        .select({ used: pgTable.used })
        .from(pgTable)
        .where(
          and(
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.feature, feature),
            eq(pgTable.userId, userId),
            gte(pgTable.usageDay, fromDay),
            lte(pgTable.usageDay, toDay),
          ),
        );
      return rows.reduce((total: number, row: { used: number }) => total + Number(row.used), 0);
    },
    async sumSharedSince({ tenantId, feature, scope, scopeId, fromDay, toDay }) {
      const rows = await db
        .select({ used: pgSharedTable.used })
        .from(pgSharedTable)
        .where(
          and(
            eq(pgSharedTable.tenantId, tenantId),
            eq(pgSharedTable.feature, feature),
            eq(pgSharedTable.scope, scope),
            eq(pgSharedTable.scopeId, scopeId),
            gte(pgSharedTable.usageDay, fromDay),
            lte(pgSharedTable.usageDay, toDay),
          ),
        );
      return rows.reduce((total: number, row: { used: number }) => total + Number(row.used), 0);
    },
    async increment({ tenantId, feature, userId, deptId, usageDay, delta, now }) {
      await db
        .insert(pgTable)
        .values({ tenantId, feature, userId, deptId, usageDay, used: delta, updatedAt: now })
        .onConflictDoUpdate({
          target: [pgTable.tenantId, pgTable.feature, pgTable.userId, pgTable.usageDay],
          set: { used: sql`${pgTable.used} + ${delta}`, deptId, updatedAt: now },
        });
    },
    async incrementShared({ tenantId, feature, scope, scopeId, usageDay, delta, now }) {
      await db
        .insert(pgSharedTable)
        .values({ tenantId, feature, scope, scopeId, usageDay, used: delta, updatedAt: now })
        .onConflictDoUpdate({
          target: [
            pgSharedTable.tenantId,
            pgSharedTable.feature,
            pgSharedTable.scope,
            pgSharedTable.scopeId,
            pgSharedTable.usageDay,
          ],
          set: { used: sql`${pgSharedTable.used} + ${delta}`, updatedAt: now },
        });
    },
  };
}

export function createMysqlFeatureUsageOps(db: UsageDb): FeatureUsageCounterOps {
  return {
    async lockTenant(tenantId) {
      const rows = await db
        .select({ id: mysqlTenants.id })
        .from(mysqlTenants)
        .where(eq(mysqlTenants.id, tenantId))
        .for("update")
        .limit(1);
      if (rows.length === 0) throw new Error("feature usage tenant not found");
      return () => {};
    },
    async sumSince({ tenantId, feature, userId, fromDay, toDay }) {
      const rows = await db
        .select({ used: mysqlTable.used })
        .from(mysqlTable)
        .where(
          and(
            eq(mysqlTable.tenantId, tenantId),
            eq(mysqlTable.feature, feature),
            eq(mysqlTable.userId, userId),
            gte(mysqlTable.usageDay, fromDay),
            lte(mysqlTable.usageDay, toDay),
          ),
        )
        .for("update");
      return rows.reduce((total: number, row: { used: number }) => total + Number(row.used), 0);
    },
    async sumSharedSince({ tenantId, feature, scope, scopeId, fromDay, toDay }) {
      const rows = await db
        .select({ used: mysqlSharedTable.used })
        .from(mysqlSharedTable)
        .where(
          and(
            eq(mysqlSharedTable.tenantId, tenantId),
            eq(mysqlSharedTable.feature, feature),
            eq(mysqlSharedTable.scope, scope),
            eq(mysqlSharedTable.scopeId, scopeId),
            gte(mysqlSharedTable.usageDay, fromDay),
            lte(mysqlSharedTable.usageDay, toDay),
          ),
        )
        .for("update");
      return rows.reduce((total: number, row: { used: number }) => total + Number(row.used), 0);
    },
    async increment({ tenantId, feature, userId, deptId, usageDay, delta, now }) {
      await db
        .insert(mysqlTable)
        .values({ tenantId, feature, userId, deptId, usageDay, used: delta, updatedAt: now })
        .onDuplicateKeyUpdate({
          set: { used: sql`${mysqlTable.used} + ${delta}`, deptId, updatedAt: now },
        });
    },
    async incrementShared({ tenantId, feature, scope, scopeId, usageDay, delta, now }) {
      await db
        .insert(mysqlSharedTable)
        .values({ tenantId, feature, scope, scopeId, usageDay, used: delta, updatedAt: now })
        .onDuplicateKeyUpdate({
          set: { used: sql`${mysqlSharedTable.used} + ${delta}`, updatedAt: now },
        });
    },
  };
}

const IN_MEMORY_OPT_IN = "AGX_ALLOW_IN_MEMORY_FEATURE_USAGE";

function allowsInMemoryCounters(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "test" || nodeEnv === "development") return true;
  if (nodeEnv === "production") return false;
  return /^(?:1|true)$/iu.test(process.env[IN_MEMORY_OPT_IN]?.trim() ?? "");
}

let memorySingleton: FeatureUsageCounterOps | null = null;
let opsOverride: FeatureUsageCounterOps | null = null;

async function resolveOps(): Promise<FeatureUsageCounterOps> {
  if (!process.env.DATABASE_URL?.trim()) {
    if (!allowsInMemoryCounters()) {
      throw new Error("feature usage counters require a configured database");
    }
    memorySingleton ??= memoryOps();
    return memorySingleton;
  }
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql"
    ? createMysqlFeatureUsageOps((await createMysqlDb(config)).raw)
    : createPgFeatureUsageOps(getIamDb());
}

export async function featureUsageCounterOps(): Promise<FeatureUsageCounterOps> {
  return opsOverride ?? resolveOps();
}

/** A search reservation needs its own transaction; a research run supplies one. */
export async function withFeatureUsageTransaction<T>(
  work: (store: FeatureUsageCounterOps) => Promise<T>,
): Promise<T> {
  if (opsOverride) return work(opsOverride);
  if (!process.env.DATABASE_URL?.trim()) return work(await resolveOps());
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const db = (await createMysqlDb(config)).raw;
    return db.transaction((tx: UsageDb) => work(createMysqlFeatureUsageOps(tx)));
  }
  return getIamDb().transaction((tx) => work(createPgFeatureUsageOps(tx)));
}

/** Test seam — swap the storage layer without a database. */
export function __setFeatureUsageOpsForTests(next: FeatureUsageCounterOps | null): void {
  opsOverride = next;
  if (next === null) memorySingleton = null;
}

export function __createMemoryFeatureUsageOps(): FeatureUsageCounterOps {
  return memoryOps();
}

export async function readFeatureUsageTotals(input: {
  tenantId: string;
  feature: MeteredFeature;
  userId: string;
  now?: Date;
}, store?: FeatureUsageCounterOps): Promise<FeatureUsageWindowTotals> {
  const now = input.now ?? new Date();
  store ??= await featureUsageCounterOps();
  const counters = store;
  const totals = { ...ZERO_TOTALS };
  await Promise.all(
    FEATURE_USAGE_WINDOWS.map(async (window) => {
      const { fromDay, toDay } = featureUsageDayRange(window, now);
      totals[window] = await counters.sumSince({
        tenantId: input.tenantId,
        feature: input.feature,
        userId: input.userId,
        fromDay,
        toDay,
      });
    }),
  );
  return totals;
}

export async function readSharedFeatureUsageTotals(input: {
  tenantId: string;
  feature: MeteredFeature;
  scope: SharedFeatureUsageScope;
  scopeId: string;
  now?: Date;
}, store?: FeatureUsageCounterOps): Promise<FeatureUsageWindowTotals> {
  const now = input.now ?? new Date();
  store ??= await featureUsageCounterOps();
  const totals = { ...ZERO_TOTALS };
  await Promise.all(
    FEATURE_USAGE_WINDOWS.map(async (window) => {
      const { fromDay, toDay } = featureUsageDayRange(window, now);
      totals[window] = await store.sumSharedSince({ ...input, fromDay, toDay });
    }),
  );
  return totals;
}

function hasLimits(policies: FeatureUsagePolicies): boolean {
  return [policies.personal, policies.department, policies.company].some(({ limits }) =>
    limits.day > 0 || limits.week > 0 || limits.month > 0);
}

/** Effective headroom across the independently counted personal and shared pools. */
export async function readFeatureUsagePolicyState(input: {
  tenantId: string;
  feature: MeteredFeature;
  userId: string;
  deptId?: string | null;
  policies: FeatureUsagePolicies;
  now?: Date;
}, store?: FeatureUsageCounterOps) {
  if (!hasLimits(input.policies)) return combineFeatureUsageStates(input.feature, []);
  store ??= await featureUsageCounterOps();
  const states = [];
  if (Object.values(input.policies.personal.limits).some((value) => value > 0)) {
    const used = await readFeatureUsageTotals(input, store);
    states.push(featureUsageState(input.feature, input.policies.personal, used));
  }
  const deptId = input.deptId?.trim();
  if (deptId && Object.values(input.policies.department.limits).some((value) => value > 0)) {
    const used = await readSharedFeatureUsageTotals(
      { ...input, scope: "department", scopeId: deptId },
      store,
    );
    states.push(featureUsageState(input.feature, input.policies.department, used));
  }
  if (Object.values(input.policies.company.limits).some((value) => value > 0)) {
    const used = await readSharedFeatureUsageTotals(
      { ...input, scope: "company", scopeId: input.tenantId },
      store,
    );
    states.push(featureUsageState(input.feature, input.policies.company, used));
  }
  return combineFeatureUsageStates(input.feature, states);
}

async function incrementAll(
  store: FeatureUsageCounterOps,
  input: {
    tenantId: string;
    feature: MeteredFeature;
    userId: string;
    deptId?: string | null;
    now: Date;
    delta: number;
  },
) {
  const deptId = input.deptId?.trim() || null;
  const common = {
    tenantId: input.tenantId,
    feature: input.feature,
    usageDay: utcUsageDay(input.now),
    delta: input.delta,
    now: input.now,
  };
  const applied: Array<() => Promise<void>> = [];
  const apply = async (write: () => Promise<void>, undo: () => Promise<void>) => {
    await write();
    applied.push(undo);
  };
  try {
    await apply(
      () => store.increment({ ...common, userId: input.userId, deptId }),
      () => store.increment({ ...common, userId: input.userId, deptId, delta: -input.delta }),
    );
    if (deptId) {
      await apply(
        () => store.incrementShared({ ...common, scope: "department", scopeId: deptId }),
        () => store.incrementShared({
          ...common,
          scope: "department",
          scopeId: deptId,
          delta: -input.delta,
        }),
      );
    }
    await apply(
      () => store.incrementShared({ ...common, scope: "company", scopeId: input.tenantId }),
      () => store.incrementShared({
        ...common,
        scope: "company",
        scopeId: input.tenantId,
        delta: -input.delta,
      }),
    );
  } catch (error) {
    for (const undo of applied.reverse()) {
      try {
        await undo();
      } catch {
        // A SQL transaction aborts on the first failed statement and rolls
        // the whole callback back when this error leaves the transaction.
      }
    }
    throw error;
  }
}

export async function reserveFeatureUsageWithStore(
  store: FeatureUsageCounterOps,
  input: {
    tenantId: string;
    feature: MeteredFeature;
    userId: string;
    deptId?: string | null;
    policies: FeatureUsagePolicies;
    now: Date;
  },
): Promise<void> {
  const release = await store.lockTenant(input.tenantId);
  try {
    const state = await readFeatureUsagePolicyState(input, store);
    if (state.binding && state.binding.remaining <= 0) {
      throw new FeatureUsageLimitError(input.feature, state.binding);
    }
    await incrementAll(store, { ...input, delta: 1 });
  } finally {
    release();
  }
}

export async function reserveFeatureUsage(
  input: {
    tenantId: string;
    feature: MeteredFeature;
    userId: string;
    deptId?: string | null;
    policies: FeatureUsagePolicies;
    now: Date;
  },
): Promise<void> {
  await withFeatureUsageTransaction((store) => reserveFeatureUsageWithStore(store, input));
}

/** Add to today's counter. Callers decide how to report a failed write. */
export async function recordFeatureUsage(input: {
  tenantId: string;
  feature: MeteredFeature;
  userId: string;
  deptId?: string | null;
  delta?: number;
  now?: Date;
}): Promise<void> {
  const delta = Math.max(1, Math.floor(input.delta ?? 1));
  const now = input.now ?? new Date();
  await withFeatureUsageTransaction(async (store) => {
    const release = await store.lockTenant(input.tenantId);
    try {
      await incrementAll(store, { ...input, delta, now });
    } finally {
      release();
    }
  });
}

/** Server-resolved policy for a new research run. Absent on continuations. */
export type ResearchUsagePolicy = {
  policies: FeatureUsagePolicies;
  deptId?: string | null;
};

/** Caller holds the transaction and commits the counter with the new run. */
export async function reserveResearchUsage(
  store: FeatureUsageCounterOps,
  input: { tenantId: string; userId: string; usage: ResearchUsagePolicy; now: Date },
): Promise<void> {
  try {
    await reserveFeatureUsageWithStore(store, {
      tenantId: input.tenantId,
      feature: "deep_research_runs",
      userId: input.userId,
      deptId: input.usage.deptId,
      policies: input.usage.policies,
      now: input.now,
    });
  } catch (error) {
    if (error instanceof FeatureUsageLimitError) throw error;
    throw new FeatureUsageUnavailableError("deep_research_runs", error);
  }
}

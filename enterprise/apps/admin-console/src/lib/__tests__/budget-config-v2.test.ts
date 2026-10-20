import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listUserGroups: vi.fn(),
}));

vi.mock("@agenticx/iam-core", () => ({
  getIamDb: () => mocks.getDb(),
  listUserGroups: (...args: unknown[]) => mocks.listUserGroups(...args),
}));

import {
  BudgetConflictError,
  budgetGatewaySnapshot,
  buildBudgetSnapshotForGateway,
  getBudgetConfig,
  mergeBudgetPatch,
  normalizeBudget,
  setBudgetConfig,
} from "../db-stores/postgresql/budget-store";

const STORED_AT = new Date("2026-04-01T08:30:00.000Z");
const originalTenant = process.env.DEFAULT_TENANT_ID;

type MemoryRow = { tenantId: string; config: unknown; updatedAt: Date };

function memoryDb(memory: { row: MemoryRow | null; inserts: number; updates: number }) {
  const selectChain = {
    from() {
      return selectChain;
    },
    where() {
      return selectChain;
    },
    orderBy() {
      return selectChain;
    },
    limit() {
      return Promise.resolve(memory.row ? [memory.row] : []);
    },
  };
  return {
    select: () => selectChain,
    insert: () => ({
      values: (values: MemoryRow) => ({
        onConflictDoNothing: async () => {
          memory.inserts += 1;
          if (!memory.row) memory.row = values;
        },
        onConflictDoUpdate: async () => {
          memory.inserts += 1;
          memory.row = values;
        },
      }),
    }),
    update: () => ({
      set: (values: { config: unknown; updatedAt: Date }) => ({
        where: () => ({
          returning: async () => {
            memory.updates += 1;
            if (!memory.row) return [];
            memory.row = { ...memory.row, config: values.config, updatedAt: values.updatedAt };
            return [{ tenantId: memory.row.tenantId }];
          },
        }),
      }),
    }),
  };
}

describe("budget config v2", () => {
  const memory = { row: null as MemoryRow | null, inserts: 0, updates: 0 };

  beforeEach(() => {
    memory.row = null;
    memory.inserts = 0;
    memory.updates = 0;
    process.env.DEFAULT_TENANT_ID = "tenant-a";
    mocks.getDb.mockReset();
    mocks.listUserGroups.mockReset();
    mocks.getDb.mockImplementation(() => memoryDb(memory));
    mocks.listUserGroups.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalTenant === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalTenant;
  });

  it("moves legacy defaults onto the current tenant and does not rewrite updatedAt on read", async () => {
    memory.row = {
      tenantId: "tenant-a",
      updatedAt: STORED_AT,
      config: {
        defaults: { unit: "tokens", period: "month", limit: 100, warnThresholdPct: 70, action: "warn" },
        departments: { research: { unit: "tokens", period: "day", limit: 20, action: "fallback", fallbackModel: "mini" } },
      },
    };

    const config = await getBudgetConfig();

    expect(memory.inserts).toBe(0);
    expect(config.updatedAt).toBe(STORED_AT.toISOString());
    expect(config.version).toBe(2);
    expect(config.defaults.limit).toBe(0);
    expect(config.tenants["tenant-a"]).toMatchObject({ unit: "tokens", period: "month", limit: 100, action: "block" });
    expect(config.tenants["tenant-a"]?.fallbackModel).toBeUndefined();
    expect(config.departments.research?.action).toBe("block");
    expect(config.departments.research?.fallbackModel).toBeUndefined();
    expect(config.companyLimits).toEqual({ tokens: 0, costUsd: 0 });
  });

  it("keeps an existing organization rule when migrating a legacy default", () => {
    const normalized = normalizeBudget(
      {
        defaults: { unit: "tokens", period: "month", limit: 100, action: "warn" },
        tenants: { "tenant-a": { unit: "cost_usd", period: "month", limit: 50, action: "warn" } },
      },
      { updatedAt: STORED_AT, tenantId: "tenant-a" },
    );
    expect(normalized.tenants["tenant-a"]).toMatchObject({ unit: "cost_usd", limit: 50, action: "block" });
    expect(normalized.defaults.limit).toBe(0);
  });

  it("accepts a week period and forces shared-pool actions to block", () => {
    const normalized = normalizeBudget(
      {
        version: 2,
        defaults: { unit: "tokens", period: "week", limit: 10, action: "warn" },
        tenants: { "tenant-a": { unit: "tokens", period: "month", limit: 5, action: "warn", fallbackModel: "mini" } },
        departments: { research: { unit: "tokens", period: "day", limit: 2, action: "fallback", fallbackModel: "mini" } },
        users: { analyst: { unit: "tokens", period: "month", limit: 8, action: "warn" } },
      },
      { updatedAt: STORED_AT, tenantId: "tenant-a" },
    );
    expect(normalized.defaults.period).toBe("week");
    expect(normalized.defaults.action).toBe("warn");
    expect(normalized.tenants["tenant-a"]?.action).toBe("block");
    expect(normalized.tenants["tenant-a"]?.fallbackModel).toBeUndefined();
    expect(normalized.departments.research?.action).toBe("block");
    expect(normalized.users.analyst?.action).toBe("warn");
    expect(normalized.updatedAt).toBe(STORED_AT.toISOString());
  });

  it("replaces only the submitted top-level field", () => {
    const current = normalizeBudget(
      {
        version: 2,
        companyLimits: { tokens: 10, costUsd: 1 },
        defaults: { unit: "tokens", period: "week", limit: 7, action: "warn" },
        departments: { research: { unit: "tokens", period: "day", limit: 3, action: "warn" } },
        users: { analyst: { unit: "cost_usd", period: "month", limit: 2, action: "fallback", fallbackModel: "economy" } },
        groups: { analysts: { unit: "tokens", period: "month", limit: 4, action: "warn" } },
      },
      { updatedAt: STORED_AT, tenantId: "tenant-a" },
    );
    const next = normalizeBudget(
      { ...mergeBudgetPatch(current, { companyLimits: { tokens: 20.2, costUsd: 0 } }), version: 2 },
      { updatedAt: STORED_AT, tenantId: "tenant-a" },
    );
    expect(next.companyLimits).toEqual({ tokens: 20, costUsd: 0 });
    expect(next.defaults).toMatchObject({ period: "week", limit: 7 });
    expect(next.departments.research?.limit).toBe(3);
    expect(next.users.analyst?.fallbackModel).toBe("economy");
    expect(next.groups.analysts?.limit).toBe(4);
    expect(next.updatedAt).toBe(STORED_AT.toISOString());

    const cleared = normalizeBudget({ ...mergeBudgetPatch(current, { departments: {} }), version: 2 }, { updatedAt: STORED_AT, tenantId: "tenant-a" });
    expect(cleared.departments).toEqual({});
    expect(cleared.users.analyst?.limit).toBe(2);
  });

  it("rejects a stale expectedUpdatedAt without writing", async () => {
    memory.row = {
      tenantId: "tenant-a",
      updatedAt: STORED_AT,
      config: { version: 2, defaults: { unit: "tokens", period: "month", limit: 1, action: "warn" } },
    };
    await expect(
      setBudgetConfig({ companyLimits: { tokens: 5, costUsd: 1 } }, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(BudgetConflictError);
    expect(memory.updates).toBe(0);
    expect(memory.inserts).toBe(0);
  });

  it("builds userGroups only for live groups with a positive limit, trimmed and sorted", async () => {
    memory.row = {
      tenantId: "tenant-a",
      updatedAt: STORED_AT,
      config: {
        version: 2,
        groups: {
          g1: { unit: "tokens", period: "month", limit: 60, action: "warn" },
          g2: { unit: "tokens", period: "day", limit: 8, action: "block" },
          zero: { unit: "tokens", period: "month", limit: 0, action: "block" },
          deleted: { unit: "tokens", period: "month", limit: 50, action: "block" },
        },
        users: { analyst: { unit: "tokens", period: "month", limit: 200, action: "warn" } },
      },
    };
    mocks.listUserGroups.mockResolvedValue([
      { id: "g2", memberIds: [" u2 ", "u1", ""] },
      { id: "g1", memberIds: ["u1", "u1"] },
      { id: "zero", memberIds: ["u1"] },
    ]);

    const snapshot = await buildBudgetSnapshotForGateway("tenant-a");

    expect(mocks.listUserGroups).toHaveBeenCalledWith("tenant-a");
    expect(snapshot.userGroups).toEqual({ u1: ["g1", "g2"], u2: ["g2"] });
    expect(snapshot.groups).not.toHaveProperty("deleted");
    expect(snapshot.groups.zero?.limit).toBe(0);
    expect(snapshot.users.analyst?.limit).toBe(200);
    expect(snapshot.updatedAt).toBe(STORED_AT.toISOString());
    expect(
      budgetGatewaySnapshot(snapshot, [{ id: "g1", memberIds: [" u1 ", "u1"] }]).userGroups,
    ).toEqual({ u1: ["g1"] });
  });
});

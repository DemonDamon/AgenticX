import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredRow = { tenantId: string; config: Record<string, unknown>; updatedAt: Date };

const mocks = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  migrateLegacyQuotasIfNeeded: vi.fn(),
  insertWinner: null as StoredRow | null,
}));

type Predicate = { tenantId?: string; updatedAt?: Date };

const fakeDb = {
  select: () => ({
    from: () => ({
      where: (predicate: Predicate) => ({
        limit: async () => {
          const row = predicate.tenantId ? mocks.rows.get(predicate.tenantId) : undefined;
          return row ? [row] : [];
        },
      }),
    }),
  }),
  insert: () => ({
    values: (row: StoredRow) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          if (mocks.insertWinner?.tenantId === row.tenantId) {
            mocks.rows.set(row.tenantId, mocks.insertWinner);
            mocks.insertWinner = null;
            return [];
          }
          if (mocks.rows.has(row.tenantId)) return [];
          mocks.rows.set(row.tenantId, row);
          return [{ tenantId: row.tenantId }];
        },
      }),
    }),
  }),
  update: () => ({
    set: (patch: Pick<StoredRow, "config" | "updatedAt">) => ({
      where: (predicate: Predicate) => ({
        returning: async () => {
          const current = predicate.tenantId ? mocks.rows.get(predicate.tenantId) : undefined;
          if (
            !current ||
            (predicate.updatedAt && current.updatedAt.getTime() !== predicate.updatedAt.getTime())
          ) return [];
          mocks.rows.set(current.tenantId, { ...current, ...patch });
          return [{ tenantId: current.tenantId }];
        },
      }),
    }),
  }),
};

vi.mock("@agenticx/db-schema", () => ({
  enterpriseRuntimeTokenQuotas: { tenantId: "tenantId", updatedAt: "updatedAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ [column]: value }),
  and: (...parts: Predicate[]) => Object.assign({}, ...parts),
}));

vi.mock("@agenticx/iam-core", () => ({
  getIamDb: () => fakeDb,
  migrateLegacyQuotasIfNeeded: (...args: unknown[]) =>
    mocks.migrateLegacyQuotasIfNeeded(...args),
  resolveRuntimeAdminDir: () => "/runtime",
}));

describe("PostgreSQL token quota tenant isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.rows.clear();
    mocks.insertWinner = null;
    mocks.migrateLegacyQuotasIfNeeded.mockReset();
    mocks.migrateLegacyQuotasIfNeeded.mockResolvedValue({ action: "skipped", count: 0 });
  });

  it("keeps reads, writes, and legacy migration independent per tenant", async () => {
    const store = await import("./token-quota-store");
    await store.setQuotaConfig(
      { users: { shared: { monthlyTokens: 111, action: "block" } } },
      "tenant-a",
    );
    await store.setQuotaConfig(
      { users: { shared: { monthlyTokens: 222, action: "warn" } } },
      "tenant-b",
    );

    const [quotaA, quotaB] = await Promise.all([
      store.getQuotaConfig("tenant-a"),
      store.getQuotaConfig("tenant-b"),
    ]);

    expect(quotaA.users.shared?.monthlyTokens).toBe(111);
    expect(quotaB.users.shared?.monthlyTokens).toBe(222);
    expect([...mocks.rows.keys()].sort()).toEqual(["tenant-a", "tenant-b"]);
    expect(mocks.migrateLegacyQuotasIfNeeded).toHaveBeenCalledTimes(2);
    expect(mocks.migrateLegacyQuotasIfNeeded).toHaveBeenCalledWith("tenant-a");
    expect(mocks.migrateLegacyQuotasIfNeeded).toHaveBeenCalledWith("tenant-b");
  });

  it("retries a failed legacy migration for the same tenant", async () => {
    mocks.migrateLegacyQuotasIfNeeded
      .mockRejectedValueOnce(new Error("temporary migration failure"))
      .mockResolvedValueOnce({ action: "skipped", count: 0 });
    const store = await import("./token-quota-store");

    await expect(store.getQuotaConfig("tenant-retry")).rejects.toThrow(
      "temporary migration failure",
    );
    await expect(store.getQuotaConfig("tenant-retry")).resolves.toBeDefined();
    expect(mocks.migrateLegacyQuotasIfNeeded).toHaveBeenCalledTimes(2);
  });

  it("re-reads the row that won a concurrent first initialization", async () => {
    const winner: StoredRow = {
      tenantId: "tenant-race",
      config: {
        users: { winner: { monthlyTokens: 333, action: "block" } },
      },
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
    };
    mocks.insertWinner = winner;
    const store = await import("./token-quota-store");

    const config = await store.getQuotaConfig("tenant-race");

    expect(config.users).toHaveProperty("winner");
    expect(config.updatedAt).toBe(winner.updatedAt.toISOString());
  });

  it("rejects a stale quota version instead of overwriting a newer edit", async () => {
    const store = await import("./token-quota-store");
    const first = await store.setQuotaConfig({ users: {} }, "tenant-cas");
    await store.setQuotaConfig(
      { users: { current: { monthlyTokens: 10, action: "block" } }, updatedAt: first.updatedAt },
      "tenant-cas",
    );

    await expect(
      store.setQuotaConfig(
        { users: { stale: { monthlyTokens: 20, action: "block" } } },
        "tenant-cas",
        first.updatedAt,
      ),
    ).rejects.toBeInstanceOf(store.QuotaConfigConflictError);
    await expect(store.getQuotaConfig("tenant-cas")).resolves.toMatchObject({
      users: { current: { monthlyTokens: 10 } },
    });
  });
});

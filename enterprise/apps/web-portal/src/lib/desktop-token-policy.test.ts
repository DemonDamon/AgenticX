import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMysqlDb: vi.fn(),
  getIamDb: vi.fn(),
  resolveDatabaseConfig: vi.fn(),
}));

vi.mock("@agenticx/iam-core", () => ({
  createMysqlDb: (...args: unknown[]) => mocks.createMysqlDb(...args),
  getIamDb: (...args: unknown[]) => mocks.getIamDb(...args),
  resolveDatabaseConfig: (...args: unknown[]) => mocks.resolveDatabaseConfig(...args),
}));

function queryDb(rows: Array<{ config: unknown }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, limit };
}

describe("desktop token alert policy", { timeout: 30_000 }, () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.DATABASE_URL = "postgresql://example.invalid/agenticx";
  });

  afterEach(() => {
    warn.mockRestore();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("uses defaults when this deployment has no database policy source", async () => {
    delete process.env.DATABASE_URL;
    const { loadDesktopSessionTokenLimits } = await import("./desktop-token-policy");

    await expect(loadDesktopSessionTokenLimits("tenant-a")).resolves.toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(mocks.resolveDatabaseConfig).not.toHaveBeenCalled();
  });

  it("reads the authenticated tenant policy from PostgreSQL", async () => {
    const db = queryDb([
      {
        config: {
          sessionTokenLimits: {
            warningTokensPerSession: 750_000,
            maxTokensPerSession: 1_500_000,
          },
        },
      },
    ]);
    mocks.resolveDatabaseConfig.mockReturnValue({
      dialect: "postgresql",
      url: process.env.DATABASE_URL,
    });
    mocks.getIamDb.mockReturnValue(db);
    const { loadDesktopSessionTokenLimits } = await import("./desktop-token-policy");

    await expect(loadDesktopSessionTokenLimits(" tenant-pg ")).resolves.toEqual({
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    });
    expect(db.where).toHaveBeenCalledOnce();
    expect(mocks.createMysqlDb).not.toHaveBeenCalled();
  });

  it("reads MySQL and defaults a missing tenant row", async () => {
    const db = queryDb([]);
    mocks.resolveDatabaseConfig.mockReturnValue({
      dialect: "mysql",
      url: "mysql://example.invalid/agenticx",
    });
    mocks.createMysqlDb.mockResolvedValue({ raw: db });
    const { loadDesktopSessionTokenLimits } = await import("./desktop-token-policy");

    await expect(loadDesktopSessionTokenLimits("tenant-mysql")).resolves.toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(db.where).toHaveBeenCalledOnce();
    expect(mocks.getIamDb).not.toHaveBeenCalled();
  });

  it("falls back to defaults when an older PostgreSQL database has no budget table", async () => {
    const db = queryDb([]);
    db.limit.mockRejectedValueOnce(
      Object.assign(new Error('relation "enterprise_runtime_budgets" does not exist'), {
        code: "42P01",
      }),
    );
    mocks.resolveDatabaseConfig.mockReturnValue({
      dialect: "postgresql",
      url: process.env.DATABASE_URL,
    });
    mocks.getIamDb.mockReturnValue(db);
    const { loadDesktopSessionTokenLimits } = await import("./desktop-token-policy");

    await expect(loadDesktopSessionTokenLimits("tenant-legacy")).resolves.toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back to defaults when the non-critical MySQL policy query fails", async () => {
    mocks.resolveDatabaseConfig.mockReturnValue({
      dialect: "mysql",
      url: "mysql://example.invalid/agenticx",
    });
    mocks.createMysqlDb.mockRejectedValueOnce(new Error("temporary database failure"));
    const { loadDesktopSessionTokenLimits } = await import("./desktop-token-policy");

    await expect(loadDesktopSessionTokenLimits("tenant-unavailable")).resolves.toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});

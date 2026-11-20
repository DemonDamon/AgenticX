import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mysqlGet: vi.fn(async (tenantId: string) => ({ tenantId, installCopyEnabled: false })),
  mysqlUpdate: vi.fn(async (tenantId: string) => ({ tenantId, installCopyEnabled: true })),
  pgGet: vi.fn(async (tenantId: string) => ({ tenantId, installCopyEnabled: false })),
  pgUpdate: vi.fn(async (tenantId: string) => ({ tenantId, installCopyEnabled: true })),
}));
vi.mock("../db-stores/mysql/ecp-tenant-settings-store", () => ({
  getEcpTenantDistributionPolicy: mocks.mysqlGet,
  updateEcpTenantDistributionPolicy: mocks.mysqlUpdate,
}));
vi.mock("../db-stores/postgresql/ecp-tenant-settings-store", () => ({
  getEcpTenantDistributionPolicy: mocks.pgGet,
  updateEcpTenantDistributionPolicy: mocks.pgUpdate,
}));
import { getEcpTenantDistributionPolicy, updateEcpTenantDistributionPolicy } from "../ecp-tenant-settings-store";

describe("tenant settings dialect selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_DIALECT", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("infers mysql from the URL for reads and writes without an explicit dialect", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://db.example.invalid/unit");
    await getEcpTenantDistributionPolicy("tenant");
    await updateEcpTenantDistributionPolicy("tenant", { installCopyEnabled: true });
    expect(mocks.mysqlGet).toHaveBeenCalledWith("tenant");
    expect(mocks.mysqlUpdate).toHaveBeenCalledWith("tenant", { installCopyEnabled: true });
    expect(mocks.pgGet).not.toHaveBeenCalled();
    expect(mocks.pgUpdate).not.toHaveBeenCalled();
  });
  it("infers postgresql from the URL without changing policy inputs", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://db.example.invalid/unit");
    await getEcpTenantDistributionPolicy("tenant");
    await updateEcpTenantDistributionPolicy("tenant", {});
    expect(mocks.pgGet).toHaveBeenCalledWith("tenant");
    expect(mocks.pgUpdate).toHaveBeenCalledWith("tenant", {});
    expect(mocks.mysqlGet).not.toHaveBeenCalled();
    expect(mocks.mysqlUpdate).not.toHaveBeenCalled();
  });
  it("rejects inconsistent URL and dialect instead of silently selecting the wrong store", () => {
    vi.stubEnv("DATABASE_URL", "mysql://db.example.invalid/unit");
    vi.stubEnv("DATABASE_DIALECT", "postgresql");
    expect(() => getEcpTenantDistributionPolicy("tenant")).toThrow(/does not match/);
    expect(mocks.pgGet).not.toHaveBeenCalled();
    expect(mocks.mysqlGet).not.toHaveBeenCalled();
  });
  it("guards direct mysql adapter calls before opening a connection for a non-mysql configuration", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://db.example.invalid/unit");
    const mysql = await vi.importActual<typeof import("../db-stores/mysql/ecp-tenant-settings-store")>("../db-stores/mysql/ecp-tenant-settings-store");
    await expect(mysql.getEcpTenantDistributionPolicy("tenant")).rejects.toThrow(/wrong database dialect/);
    await expect(mysql.updateEcpTenantDistributionPolicy("tenant", {})).rejects.toThrow(/wrong database dialect/);
  });
});

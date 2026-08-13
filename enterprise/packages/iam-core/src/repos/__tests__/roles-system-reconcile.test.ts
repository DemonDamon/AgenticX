import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIamDb: vi.fn(),
  getMysqlRepositoryDb: vi.fn(),
  resolveDatabaseConfig: vi.fn(),
}));

vi.mock("../../db", () => ({
  getIamDb: mocks.getIamDb,
}));

vi.mock("../../database/config", () => ({
  resolveDatabaseConfig: mocks.resolveDatabaseConfig,
}));

vi.mock("../mysql/db", () => ({
  getMysqlRepositoryDb: mocks.getMysqlRepositoryDb,
}));

vi.mock("../audit", () => ({
  insertAuditEvent: vi.fn(),
}));

vi.mock("../mysql/audit", () => ({
  insertMysqlAuditEvent: vi.fn(),
}));

import { ensureSystemRoles, SYSTEM_ROLE_SEED } from "../roles";
import { MYSQL_SYSTEM_ROLE_SEED, mysqlRolesRepository } from "../mysql/roles";

type ReconcileSet = {
  name: string;
  scopes: string[];
  immutable: boolean;
  updatedAt: Date;
};

function expectSearchManagementScopes(seed: typeof SYSTEM_ROLE_SEED): void {
  const byCode = new Map(seed.map((role) => [role.code, role]));
  expect(byCode.get("owner")?.scopes).toContain("provider:update");
  expect(byCode.get("admin")?.scopes).toContain("provider:update");
  expect(byCode.get("auditor")?.scopes).not.toContain("provider:update");
  expect(byCode.get("dept_admin")?.scopes).not.toContain("provider:update");
}

describe("system role reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps PostgreSQL system roles on the canonical permission set", async () => {
    const writes: Array<{
      code: string;
      set: ReconcileSet;
      target: unknown[];
    }> = [];
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn((values: { code: string }) => ({
          onConflictDoUpdate: vi.fn(async (config: { target: unknown[]; set: ReconcileSet }) => {
            writes.push({ code: values.code, set: config.set, target: config.target });
          }),
        })),
      })),
    };
    mocks.resolveDatabaseConfig.mockReturnValue({
      dialect: "postgresql",
      url: "postgresql://localhost/agenticx",
    });
    mocks.getIamDb.mockReturnValue(db);

    await ensureSystemRoles("tenant-1");

    expectSearchManagementScopes(SYSTEM_ROLE_SEED);
    expect(writes).toHaveLength(SYSTEM_ROLE_SEED.length);
    const owner = writes.find((write) => write.code === "owner");
    const admin = writes.find((write) => write.code === "admin");
    const auditor = writes.find((write) => write.code === "auditor");
    expect(owner?.set.scopes).toContain("provider:update");
    expect(admin?.set.scopes).toContain("provider:update");
    expect(auditor?.set.scopes).not.toContain("provider:update");
    expect(owner?.set).not.toHaveProperty("id");
    expect(owner?.set).not.toHaveProperty("createdAt");
    expect(owner?.target).toHaveLength(2);
  });

  it("updates existing MySQL system roles without replacing their ids", async () => {
    expect(MYSQL_SYSTEM_ROLE_SEED).toEqual(SYSTEM_ROLE_SEED);
    expectSearchManagementScopes(MYSQL_SYSTEM_ROLE_SEED);

    let selectedIndex = 0;
    let selectedCode = "";
    const updates: Array<{ code: string; set: ReconcileSet }> = [];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              selectedCode = MYSQL_SYSTEM_ROLE_SEED[selectedIndex]?.code ?? "";
              selectedIndex += 1;
              return [{ id: `existing-${selectedCode}` }];
            }),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((set: ReconcileSet) => {
          const code = selectedCode;
          return {
            where: vi.fn(async () => {
              updates.push({ code, set });
            }),
          };
        }),
      })),
      insert: vi.fn(),
    };
    mocks.getMysqlRepositoryDb.mockResolvedValue(db);

    await mysqlRolesRepository.ensureSystemRoles("tenant-1");

    expect(updates).toHaveLength(MYSQL_SYSTEM_ROLE_SEED.length);
    expect(db.insert).not.toHaveBeenCalled();
    const owner = updates.find((update) => update.code === "owner");
    const admin = updates.find((update) => update.code === "admin");
    const auditor = updates.find((update) => update.code === "auditor");
    expect(owner?.set.scopes).toContain("provider:update");
    expect(admin?.set.scopes).toContain("provider:update");
    expect(auditor?.set.scopes).not.toContain("provider:update");
    expect(owner?.set).not.toHaveProperty("id");
    expect(owner?.set).not.toHaveProperty("createdAt");
  });
});

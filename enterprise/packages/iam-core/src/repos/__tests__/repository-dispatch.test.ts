import { afterEach, describe, expect, it, vi } from "vitest";

import { getUsersRepository } from "../users";
import { getDepartmentsRepository } from "../departments";
import { getRolesRepository } from "../roles";
import { getSsoProvidersRepository } from "../sso-providers";
import { getAuditRepository } from "../audit";

describe("IAM repository dialect dispatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["postgresql", "postgresql://localhost/agenticx"],
    ["mysql", "mysql://localhost/agenticx"],
  ] as const)("selects %s repositories from DATABASE_URL", (dialect, url) => {
    vi.stubEnv("DATABASE_URL", url);
    expect(getUsersRepository().dialect).toBe(dialect);
    expect(getDepartmentsRepository().dialect).toBe(dialect);
    expect(getRolesRepository().dialect).toBe(dialect);
    expect(getSsoProvidersRepository().dialect).toBe(dialect);
    expect(getAuditRepository().dialect).toBe(dialect);
  });

  it("returns distinct repository method implementations per dialect", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/agenticx");
    const pgUsers = getUsersRepository();
    const pgDepartments = getDepartmentsRepository();
    const pgRoles = getRolesRepository();

    vi.stubEnv("DATABASE_URL", "mysql://localhost/agenticx");
    const mysqlUsers = getUsersRepository();
    const mysqlDepartments = getDepartmentsRepository();
    const mysqlRoles = getRolesRepository();

    expect(pgUsers.listAdminUsers).not.toBe(mysqlUsers.listAdminUsers);
    expect(pgDepartments.getDepartment).not.toBe(mysqlDepartments.getDepartment);
    expect(pgRoles.resolveRoleIdsFromCodes).not.toBe(mysqlRoles.resolveRoleIdsFromCodes);
  });
});

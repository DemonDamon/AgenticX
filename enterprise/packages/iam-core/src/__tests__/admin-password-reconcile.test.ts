import type { AuthUser } from "@agenticx/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn<(raw: string) => Promise<string>>(),
  verifyPassword: vi.fn<(raw: string, hash: string) => Promise<boolean>>(),
  loadAuthUserByEmail: vi.fn<(tenantId: string, email: string) => Promise<AuthUser | null>>(),
  upsertUserRowFromAuthUser: vi.fn<(user: AuthUser) => Promise<void>>(),
}));

vi.mock("@agenticx/auth", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock("../repos/users", () => ({
  loadAuthUserByEmail: mocks.loadAuthUserByEmail,
  upsertUserRowFromAuthUser: mocks.upsertUserRowFromAuthUser,
}));

describe("reconcileUserPasswordHashByEmail", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("does nothing when the account does not exist", async () => {
    mocks.loadAuthUserByEmail.mockResolvedValueOnce(null);
    const { reconcileUserPasswordHashByEmail } = await import("../admin-password-reconcile");

    await expect(
      reconcileUserPasswordHashByEmail({
        tenantId: "tenant-1",
        email: "admin@example.com",
        password: "configured-password",
      }),
    ).resolves.toEqual({ found: false, updated: false, user: null });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.upsertUserRowFromAuthUser).not.toHaveBeenCalled();
  });

  it("does not write when the configured password already matches", async () => {
    const user: AuthUser = {
      id: "user-1",
      tenantId: "tenant-1",
      deptId: null,
      email: "admin@example.com",
      displayName: "Seed Admin",
      passwordHash: "current-hash",
      mustChangePassword: false,
      status: "active",
      failedLoginCount: 2,
      lockedUntil: null,
      scopes: ["admin:enter"],
    };
    mocks.loadAuthUserByEmail.mockResolvedValueOnce(user);
    mocks.verifyPassword.mockResolvedValueOnce(true);
    const { reconcileUserPasswordHashByEmail } = await import("../admin-password-reconcile");

    await expect(
      reconcileUserPasswordHashByEmail({
        tenantId: "tenant-1",
        email: "admin@example.com",
        password: "configured-password",
      }),
    ).resolves.toEqual({ found: true, updated: false, user });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.upsertUserRowFromAuthUser).not.toHaveBeenCalled();
  });

  it("rehashes, unlocks, and preserves a pending password change", async () => {
    const user: AuthUser = {
      id: "user-1",
      tenantId: "tenant-1",
      deptId: null,
      email: "admin@example.com",
      displayName: "Seed Admin",
      passwordHash: "stale-hash",
      mustChangePassword: true,
      status: "locked",
      failedLoginCount: 5,
      lockedUntil: Date.now() + 60_000,
      scopes: ["admin:enter"],
    };
    mocks.loadAuthUserByEmail.mockResolvedValueOnce(user);
    mocks.verifyPassword.mockResolvedValueOnce(false);
    mocks.hashPassword.mockResolvedValueOnce("new-hash");
    const { reconcileUserPasswordHashByEmail } = await import("../admin-password-reconcile");

    const result = await reconcileUserPasswordHashByEmail({
      tenantId: "tenant-1",
      email: "ADMIN@example.com",
      password: "configured-password",
    });

    const expected: AuthUser = {
      ...user,
      email: "admin@example.com",
      passwordHash: "new-hash",
      failedLoginCount: 0,
      lockedUntil: null,
      status: "active",
    };
    expect(mocks.hashPassword).toHaveBeenCalledWith("configured-password");
    expect(mocks.upsertUserRowFromAuthUser).toHaveBeenCalledWith(expected);
    expect(result).toEqual({ found: true, updated: true, user: expected });
  });
});

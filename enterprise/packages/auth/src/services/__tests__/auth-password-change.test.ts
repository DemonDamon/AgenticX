import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService, InMemoryAuthUserRepository, InMemoryRefreshTokenStore } from "../auth";
import { JwtService } from "../jwt";
import { hashPassword } from "../password";
import type { AuthUser } from "../../types";

const EMAIL = "member@example.com";
const PASSWORD = "Initial-password-1!";

async function createRequiredChangeService() {
  const passwordHash = await hashPassword(PASSWORD);
  const user: AuthUser = {
    id: "user-1",
    tenantId: "tenant-1",
    deptId: "dept-1",
    email: EMAIL,
    displayName: "Member",
    passwordHash,
    mustChangePassword: true,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    scopes: ["workspace:chat"],
  };
  const userRepo = new InMemoryAuthUserRepository([user]);
  const refreshStore = new InMemoryRefreshTokenStore();
  const jwtService = new JwtService({
    issuer: "password-change-test",
    audience: "password-change-test-client",
    accessTtlSeconds: 60,
    refreshTtlSeconds: 60,
  });
  return {
    userRepo,
    refreshStore,
    jwtService,
    service: new AuthService({ userRepo, refreshStore, jwtService }),
  };
}

describe("AuthService required password change", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_EPHEMERAL_JWT_KEYS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves the requirement in login and refreshed tokens", async () => {
    const { service, jwtService } = await createRequiredChangeService();
    const login = await service.loginWithPassword({ email: EMAIL, password: PASSWORD });

    expect(login.mustChangePassword).toBe(true);
    expect((await jwtService.verifyAccessToken(login.accessToken))?.mustChangePassword).toBe(true);
    expect((await jwtService.verifyRefreshToken(login.refreshToken))?.mustChangePassword).toBe(true);

    const refreshed = await service.refresh(login.refreshToken);
    expect(refreshed.mustChangePassword).toBe(true);
    expect((await jwtService.verifyAccessToken(refreshed.accessToken))?.mustChangePassword).toBe(true);
  });

  it("clears the requirement, replaces the password, and revokes the old refresh session", async () => {
    const { service, userRepo } = await createRequiredChangeService();
    const login = await service.loginWithPassword({ email: EMAIL, password: PASSWORD });
    const context = await service.verifyAccess(login.accessToken);
    expect(context).not.toBeNull();

    const nextPassword = "Replacement-password-2!";
    const completed = await service.completeRequiredPasswordChange({
      context: context!,
      newPassword: nextPassword,
    });

    expect(completed.mustChangePassword).toBe(false);
    expect((await service.verifyAccess(completed.accessToken))?.mustChangePassword).toBe(false);
    expect(await userRepo.findByEmail(EMAIL)).toMatchObject({
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    await expect(service.refresh(login.refreshToken)).rejects.toThrow("Refresh session expired.");
    await expect(service.loginWithPassword({ email: EMAIL, password: PASSWORD })).rejects.toThrow(
      "Invalid credentials.",
    );
    await expect(service.loginWithPassword({ email: EMAIL, password: nextPassword })).resolves.toMatchObject({
      mustChangePassword: false,
    });
  });

  it("rejects a completion request for a normal session", async () => {
    const { service, userRepo } = await createRequiredChangeService();
    const pending = await userRepo.findByEmail(EMAIL);
    await userRepo.updatePasswordAndClearRequirement(EMAIL, pending!.passwordHash);
    const login = await service.loginWithPassword({ email: EMAIL, password: PASSWORD });
    const context = await service.verifyAccess(login.accessToken);

    await expect(
      service.completeRequiredPasswordChange({
        context: context!,
        newPassword: "Replacement-password-2!",
      }),
    ).rejects.toThrow("Password change is not required.");
  });
});

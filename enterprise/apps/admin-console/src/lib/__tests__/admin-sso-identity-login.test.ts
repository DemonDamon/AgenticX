import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ link: vi.fn(), load: vi.fn(), byId: vi.fn(), bind: vi.fn(), scopes: vi.fn(), transaction: vi.fn() }));
vi.mock("@agenticx/iam-core", () => ({
  loadSsoAuthUserById: mocks.byId, findSsoIdentityLink: mocks.link, loadAuthUserByEmail: mocks.load, bindSsoIdentityLink: mocks.bind,
  aggregateScopesForUser: mocks.scopes, ensureSystemRoles: vi.fn(), getDefaultOrgId: vi.fn(),
  withTenantIamTransaction: mocks.transaction, hasSomeScope: (scopes: string[], required: string[]) => required.some(scope => scopes.includes(scope)),
}));
vi.mock("@agenticx/auth", () => ({ verifyPassword: vi.fn() }));
import { authenticateAdminConsoleViaOidc } from "../admin-pg-auth";
const user = { id: "user-a", tenantId: "tenant-a", email: "original@example.test", status: "active", lockedUntil: null };
const input = { tenantId: user.tenantId, providerId: "corp", issuer: "https://identity.example.test", subject: "stable", email: user.email, emailVerified: true, protocol: "oidc" as const };

describe("admin immutable SSO association", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.link.mockResolvedValue(null); mocks.load.mockResolvedValue(user); mocks.byId.mockResolvedValue(user);
    mocks.scopes.mockResolvedValue(["admin:enter"]);
    mocks.transaction.mockImplementation(async (_tenant: string, callback: () => Promise<unknown>) => callback());
  });
  it("rejects an unverified first association", async () => {
    await expect(authenticateAdminConsoleViaOidc({ ...input, emailVerified: false })).rejects.toThrow("oidc.email_unverified");
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("requires pre-provisioning and admin scope before establishing a binding", async () => {
    mocks.load.mockResolvedValueOnce(null);
    expect(await authenticateAdminConsoleViaOidc(input)).toEqual({ ok: false, reason: "admin_unprovisioned" });
    mocks.scopes.mockResolvedValueOnce([]);
    expect(await authenticateAdminConsoleViaOidc(input)).toEqual({ ok: false, reason: "admin_scope_missing" });
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("establishes a verified first binding", async () => {
    expect(await authenticateAdminConsoleViaOidc(input)).toEqual({ ok: true, userId: user.id, tenantId: user.tenantId, email: user.email });
    expect(mocks.bind).toHaveBeenCalledWith(user.tenantId, { providerId: "corp", issuer: input.issuer, subject: "stable" }, user.id);
  });
  it("uses the bound user despite a changed or unverified asserted email", async () => {
    mocks.link.mockResolvedValue({ userId: user.id, email: user.email });
    expect((await authenticateAdminConsoleViaOidc({ ...input, email: "target@example.test", emailVerified: null })).ok).toBe(true);
    expect(mocks.byId).toHaveBeenCalledWith(user.tenantId, user.id); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects disabled or replaced bound accounts", async () => {
    mocks.link.mockResolvedValue({ userId: user.id, email: user.email });
    mocks.byId.mockResolvedValueOnce({ ...user, id: "replacement" });
    expect(await authenticateAdminConsoleViaOidc(input)).toEqual({ ok: false, reason: "admin_unprovisioned" });
    mocks.byId.mockResolvedValueOnce({ ...user, status: "disabled" });
    expect(await authenticateAdminConsoleViaOidc(input)).toEqual({ ok: false, reason: "account_disabled" });
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("does not impose OIDC verification or persistent identity on SAML", async () => {
    expect((await authenticateAdminConsoleViaOidc({ tenantId: user.tenantId, email: user.email, protocol: "saml" })).ok).toBe(true);
    expect(mocks.link).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

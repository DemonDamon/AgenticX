import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@agenticx/auth";

const mocks = vi.hoisted(() => ({
  links: new Map<string, { userId: string; email: string }>(),
  users: new Map<string, AuthUser>(),
  bind: vi.fn(), roles: vi.fn(), lookup: vi.fn(), byId: vi.fn(), upsert: vi.fn(), sign: vi.fn(), transaction: vi.fn(), hash: vi.fn(), sync: vi.fn(),
}));
vi.mock("@agenticx/auth", () => ({ AuthService: class {}, InMemoryRefreshTokenStore: class {}, JwtService: class {}, hashPassword: mocks.hash }));
vi.mock("@agenticx/iam-core", () => ({
  PgAuthUserRepository: class {}, PgRefreshTokenStore: class {},
  assignRolesIfNone: mocks.roles, ensureSystemRoles: vi.fn(), getDefaultOrgId: vi.fn(async () => "org"),
  loadAuthUserByEmail: vi.fn(), replaceUserRoleAssignments: vi.fn(), upsertUserRowFromAuthUser: vi.fn(),
  insertAuditEvent: vi.fn(), sanitizeSsoAuditDetail: (x: unknown) => x,
  findSsoIdentityLink: vi.fn(async (_tenant: string, key: { subject: string }) => mocks.links.get(key.subject) ?? null),
  loadSsoAuthUserById: mocks.byId,
  insertSsoUserIfAbsent: mocks.upsert,
  bindSsoIdentityLink: mocks.bind, withTenantIamTransaction: mocks.transaction,
}));
vi.mock("../chat-history", () => ({ syncAuthUserToPostgres: mocks.sync }));
vi.mock("../auth-scopes", () => ({ getEffectiveUserScopes: (x: string[]) => x }));
import { loginWithOidcClaims } from "../auth-runtime";

const original: AuthUser = { id: "user-a", tenantId: "tenant-a", email: "original@example.test", displayName: "Original", passwordHash: "unused", mustChangePassword: false, status: "active", failedLoginCount: 0, lockedUntil: null, scopes: [] };
const input = { providerId: "corp", issuer: "https://identity.example.test", subject: "stable", email: original.email, displayName: "Original", emailVerified: true, protocol: "oidc" as const };

describe("Portal immutable SSO login", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.links.clear(); mocks.users.clear(); mocks.users.set(original.email, { ...original });
    mocks.lookup.mockImplementation(async (email: string) => mocks.users.get(email) ?? null);
    mocks.byId.mockImplementation(async (tenant: string, id: string) => [...mocks.users.values()].find(user => user.tenantId === tenant && user.id === id) ?? null);
    mocks.upsert.mockImplementation(async (user: AuthUser) => { mocks.users.set(user.email, user); });
    mocks.bind.mockImplementation(async (_tenant: string, key: { subject: string }, id: string) => { const user = [...mocks.users.values()].find(u => u.id === id)!; mocks.links.set(key.subject, { userId: id, email: user.email }); });
    mocks.transaction.mockImplementation(async (_tenant: string, callback: () => Promise<unknown>) => callback());
    mocks.hash.mockResolvedValue("random-jit-hash"); mocks.sign.mockResolvedValue({ token: "token", expiresInSeconds: 3600 });
    globalThis.__agenticxWebPortalAuthRuntime = {
      tenantId: original.tenantId, bootstrapPromise: Promise.resolve(), repo: { findByEmail: mocks.lookup, upsertUser: mocks.upsert },
      jwtService: { signAccessToken: mocks.sign, signRefreshToken: mocks.sign }, refreshStore: { set: vi.fn() },
    } as unknown as NonNullable<typeof globalThis.__agenticxWebPortalAuthRuntime>;
  });
  it("rejects unverified first association before looking up the asserted email", async () => {
    await expect(loginWithOidcClaims({ ...input, emailVerified: null })).rejects.toThrow("oidc.email_unverified");
    expect(mocks.lookup).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("binds an existing account only after verified first association", async () => {
    expect((await loginWithOidcClaims(input)).userId).toBe(original.id);
    expect(mocks.bind).toHaveBeenCalledWith(original.tenantId, expect.objectContaining({ subject: "stable" }), original.id);
  });
  it("preserves its original user when the asserted email changes or verification disappears", async () => {
    mocks.links.set("stable", { userId: original.id, email: original.email });
    mocks.users.set("target@example.test", { ...original, id: "target", email: "target@example.test" });
    expect((await loginWithOidcClaims({ ...input, email: "target@example.test", emailVerified: null })).userId).toBe(original.id);
    expect(mocks.byId).toHaveBeenCalledWith(original.tenantId, original.id);
    expect(mocks.lookup).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("never falls back to a replacement account when the bound user is deleted", async () => {
    mocks.links.set("stable", { userId: "deleted", email: original.email });
    await expect(loginWithOidcClaims(input)).rejects.toThrow("oidc.user_not_found");
    expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("rejects disabled bound users", async () => {
    mocks.links.set("stable", { userId: original.id, email: original.email });
    mocks.users.set(original.email, { ...original, status: "disabled" });
    await expect(loginWithOidcClaims(input)).rejects.toThrow("oidc.account_disabled");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("creates and binds a verified JIT account after hashing outside the lock", async () => {
    mocks.users.clear();
    const result = await loginWithOidcClaims(input);
    expect(result.jitCreated).toBe(true); expect(mocks.hash).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(2); expect(mocks.roles).toHaveBeenCalledTimes(1);
    expect(mocks.bind).toHaveBeenCalledWith(original.tenantId, expect.anything(), result.userId);
  });
  it("does not replay a stale IAM user snapshot after a concurrent administrator update", async () => {
    mocks.transaction.mockImplementation(async (_tenant: string, callback: () => Promise<unknown>) => {
      const result = await callback();
      mocks.users.set(original.email, { ...original, status: "disabled", passwordHash: "new-password-hash" });
      return result;
    });
    mocks.sync.mockImplementation(async (snapshot: AuthUser) => { mocks.users.set(snapshot.email, snapshot); });
    await loginWithOidcClaims(input);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.users.get(original.email)).toMatchObject({ status: "disabled", passwordHash: "new-password-hash" });
  });
  it("does not grant JIT roles or issue tokens if an email race finds a disabled account", async () => {
    mocks.users.clear();
    mocks.upsert.mockImplementationOnce(async () => { mocks.users.set(original.email, { ...original, status: "disabled" }); });
    await expect(loginWithOidcClaims(input)).rejects.toThrow("oidc.account_disabled");
    expect(mocks.roles).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("preserves the existing SAML trust policy without persistent transient links", async () => {
    expect((await loginWithOidcClaims({ ...input, protocol: "saml", emailVerified: null })).userId).toBe(original.id);
    expect(mocks.bind).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

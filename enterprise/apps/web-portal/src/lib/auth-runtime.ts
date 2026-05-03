import {
  AuthService,
  InMemoryRefreshTokenStore,
  JwtService,
  hashPassword,
  type AuthContext,
  type AuthTokens,
} from "@agenticx/auth";
import {
  PgAuthUserRepository,
  ensureSystemRoles,
  getDefaultOrgId,
  loadAuthUserByEmail,
  replaceUserRoleAssignments,
  upsertUserRowFromAuthUser,
} from "@agenticx/iam-core";
import { createHash } from "node:crypto";
import { syncAuthUserToPostgres } from "./chat-history";

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID?.trim();
const DEFAULT_DEPT_ID = process.env.DEFAULT_DEPT_ID?.trim();
const ENABLE_DEV_BOOTSTRAP = process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_BOOTSTRAP === "true";
const DEV_OWNER_PASSWORD = process.env.AUTH_DEV_OWNER_PASSWORD;
const WEAK_PASSWORDS = new Set(["admin123", "admin123!", "password", "password123", "qwerty123"]);

type ProvisionInput = {
  tenantId: string;
  deptId?: string | null;
  email: string;
  displayName: string;
  password: string;
  scopes?: string[];
};

type AuthRuntime = {
  repo: PgAuthUserRepository;
  authService: AuthService;
  jwtService: JwtService;
  refreshStore: InMemoryRefreshTokenStore;
  tenantId: string;
  bootstrapPromise: Promise<void>;
};

declare global {
  var __agenticxWebPortalAuthRuntime: AuthRuntime | undefined;
}

function createRuntime(): AuthRuntime {
  const tenantId = DEFAULT_TENANT_ID ?? "";
  const repo = new PgAuthUserRepository(tenantId);
  const refreshStore = new InMemoryRefreshTokenStore();
  const jwtService = new JwtService({
    issuer: "agenticx-enterprise-web-portal",
    audience: "agenticx-web-users",
    accessTtlSeconds: 60 * 60,
    refreshTtlSeconds: 7 * 24 * 60 * 60,
  });
  const authService = new AuthService({ userRepo: repo, jwtService, refreshStore });

  const bootstrapPromise = (async () => {
    if (!process.env.DATABASE_URL?.trim() || !tenantId) {
      return;
    }
    await ensureSystemRoles(tenantId);
    if (!ENABLE_DEV_BOOTSTRAP) {
      return;
    }
    if (!DEV_OWNER_PASSWORD) {
      throw new Error("AUTH_DEV_OWNER_PASSWORD is required when ENABLE_DEV_BOOTSTRAP=true.");
    }
    if (!DEFAULT_DEPT_ID) {
      throw new Error("DEFAULT_DEPT_ID is required when ENABLE_DEV_BOOTSTRAP=true.");
    }
    if (!isStrongBootstrapPassword(DEV_OWNER_PASSWORD)) {
      throw new Error("AUTH_DEV_OWNER_PASSWORD must include upper/lower/number/symbol and be at least 14 chars.");
    }
    const exists = await loadAuthUserByEmail(tenantId, "owner@agenticx.local");
    if (exists) {
      try {
        await syncAuthUserToPostgres(exists);
      } catch (err) {
        console.error("[web-portal] dev owner syncAuthUserToPostgres failed:", err);
      }
      return;
    }
    const passwordHash = await hashPassword(DEV_OWNER_PASSWORD);
    const owner: import("@agenticx/auth").AuthUser = {
      id: "01J00000000000000000000004",
      tenantId,
      deptId: DEFAULT_DEPT_ID,
      email: "owner@agenticx.local",
      displayName: "Seed Owner",
      passwordHash,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      scopes: [],
    };
    await upsertUserRowFromAuthUser(owner);
    const orgId = await getDefaultOrgId(tenantId);
    await replaceUserRoleAssignments({
      tenantId,
      userId: owner.id,
      roleCodes: ["super_admin"],
      defaultOrgId: orgId,
      defaultDeptId: DEFAULT_DEPT_ID,
    });
    const hydrated = await loadAuthUserByEmail(tenantId, owner.email);
    if (hydrated) {
      try {
        await syncAuthUserToPostgres(hydrated);
      } catch (err) {
        console.error("[web-portal] dev owner sync after PG insert failed:", err);
      }
    }
  })();

  return {
    repo,
    authService,
    jwtService,
    refreshStore,
    tenantId,
    bootstrapPromise,
  };
}

async function getRuntime(): Promise<AuthRuntime> {
  globalThis.__agenticxWebPortalAuthRuntime ??= createRuntime();
  await globalThis.__agenticxWebPortalAuthRuntime.bootstrapPromise;
  return globalThis.__agenticxWebPortalAuthRuntime;
}

function buildUserId(email: string): string {
  const slug = `user_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  if (slug.length <= 26) return slug;
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 26);
}

function isStrongBootstrapPassword(password: string): boolean {
  if (password.length < 14) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return false;
  return true;
}

function roleCodesForProvisionScopes(scopes: string[] | undefined): string[] {
  const s = scopes ?? [];
  if (s.some((x) => x.includes("user:create"))) {
    return ["admin", "member"];
  }
  return ["member"];
}

export async function provisionUserFromAdmin(input: ProvisionInput): Promise<void> {
  const runtime = await getRuntime();
  const passwordHash = await hashPassword(input.password);
  const id = buildUserId(input.email);
  const authUser: import("@agenticx/auth").AuthUser = {
    id,
    tenantId: input.tenantId,
    deptId: input.deptId ?? null,
    email: input.email.toLowerCase(),
    displayName: input.displayName,
    passwordHash,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    scopes: input.scopes?.length ? input.scopes : ["workspace:chat", "user:read"],
  };
  await runtime.repo.upsertUser(authUser);
  if (!process.env.DATABASE_URL?.trim()) return;
  const orgId = await getDefaultOrgId(input.tenantId);
  await replaceUserRoleAssignments({
    tenantId: input.tenantId,
    userId: id,
    roleCodes: roleCodesForProvisionScopes(input.scopes),
    defaultOrgId: orgId,
    defaultDeptId: input.deptId ?? null,
  });
  const saved = await runtime.repo.findByEmail(input.email.toLowerCase());
  if (saved) {
    try {
      await syncAuthUserToPostgres(saved);
    } catch (err) {
      console.error("[web-portal] provisionUserFromAdmin sync failed:", err);
    }
  }
}

export async function loginWithPassword(email: string, password: string): Promise<AuthTokens> {
  const runtime = await getRuntime();
  const tokens = await runtime.authService.loginWithPassword({ email, password });
  const user = await runtime.repo.findByEmail(email.toLowerCase());
  if (user) {
    try {
      await syncAuthUserToPostgres(user);
    } catch (err) {
      console.error("[web-portal] syncAuthUserToPostgres after login failed:", err);
    }
  }
  return tokens;
}

export async function verifyAccessToken(accessToken: string): Promise<AuthContext | null> {
  const runtime = await getRuntime();
  return runtime.authService.verifyAccess(accessToken);
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const runtime = await getRuntime();
  const refreshContext = await runtime.jwtService.verifyRefreshToken(refreshToken);
  if (!refreshContext) throw new Error("Invalid refresh token.");

  const stored = await runtime.refreshStore.get(refreshContext.sessionId);
  if (!stored || stored.userId !== refreshContext.userId || stored.tenantId !== refreshContext.tenantId) {
    throw new Error("Refresh session expired.");
  }

  const user = await runtime.repo.findByEmail(refreshContext.email.toLowerCase());
  if (!user || user.status === "disabled") throw new Error("Refresh session expired.");
  if (user.status === "locked") throw new Error("Refresh session expired.");
  if (user.lockedUntil && user.lockedUntil > Date.now()) throw new Error("Refresh session expired.");

  const nextContext: AuthContext = {
    ...refreshContext,
    scopes: user.scopes,
    deptId: user.deptId ?? null,
  };

  const access = await runtime.jwtService.signAccessToken(nextContext);
  const nextRefresh = await runtime.jwtService.signRefreshToken(nextContext);

  await runtime.refreshStore.set({
    ...stored,
    scopes: nextContext.scopes,
    deptId: nextContext.deptId ?? null,
    expiresAt: Date.now() + nextRefresh.expiresInSeconds * 1000,
  });

  return {
    accessToken: access.token,
    refreshToken: nextRefresh.token,
    tokenType: "Bearer",
    expiresInSeconds: access.expiresInSeconds,
  };
}

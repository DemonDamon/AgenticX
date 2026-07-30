import {
  InMemoryRefreshTokenStore,
  JwtService,
  hashPassword,
  verifyPassword,
  type AuthContext,
  type AuthTokens,
} from "@agenticx/auth";
import {
  assignRolesIfNone,
  createSessionGrant,
  PgAuthUserRepository,
  PgRefreshTokenStore,
  reconcileUserPasswordHashByEmail,
  ensureSystemRoles,
  getDefaultOrgId,
  insertAuditEvent,
  loadAuthUserByEmail,
  replaceUserRoleAssignments,
  sanitizeSsoAuditDetail,
  upsertUserRowFromAuthUser,
} from "@agenticx/iam-core";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { syncAuthUserToPostgres } from "./chat-history";
import { getEffectiveUserScopes } from "./auth-scopes";
import { buildPortalTokenContext } from "./portal-auth-token-context";
import { ulid } from "ulid";

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID?.trim();
const DEFAULT_DEPT_ID = process.env.DEFAULT_DEPT_ID?.trim();
const ENABLE_DEV_BOOTSTRAP = process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_BOOTSTRAP === "true";
const DEV_OWNER_PASSWORD = process.env.AUTH_DEV_OWNER_PASSWORD;
const DEV_ADMIN_EMAIL = "admin@agenticx.local";
const LEGACY_OWNER_EMAIL = "owner@agenticx.local";
const WEAK_PASSWORDS = new Set(["admin123", "admin123!", "password", "password123", "qwerty123"]);
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const PORTAL_SESSION_GRANT_SCOPES = ["workspace:chat", "workspace:read", "workspace:manage"] as const;

async function reconcileConfiguredAdminPasswordIfNeeded(email: string, password: string): Promise<void> {
  if (!DEFAULT_TENANT_ID || !DEV_OWNER_PASSWORD) return;
  if (email.trim().toLowerCase() !== DEV_ADMIN_EMAIL) return;
  if (password !== DEV_OWNER_PASSWORD) return;
  await reconcileUserPasswordHashByEmail({
    tenantId: DEFAULT_TENANT_ID,
    email: DEV_ADMIN_EMAIL,
    password: DEV_OWNER_PASSWORD,
  });
}

type ProvisionInput = {
  tenantId: string;
  deptId?: string | null;
  email: string;
  displayName: string;
  password: string;
  scopes?: string[];
  mustChangePassword?: boolean;
};

type AuthRuntime = {
  repo: PgAuthUserRepository;
  jwtService: JwtService;
  refreshStore: InMemoryRefreshTokenStore | PgRefreshTokenStore;
  tenantId: string;
  bootstrapPromise: Promise<void>;
};

declare global {
  var __agenticxWebPortalAuthRuntime: AuthRuntime | undefined;
}

function createRuntime(): AuthRuntime {
  const tenantId = DEFAULT_TENANT_ID ?? "";
  const repo = new PgAuthUserRepository(tenantId);
  const refreshStore = process.env.DATABASE_URL?.trim()
    ? new PgRefreshTokenStore()
    : new InMemoryRefreshTokenStore();
  const jwtService = new JwtService({
    issuer: "agenticx-enterprise-web-portal",
    audience: "agenticx-web-users",
    accessTtlSeconds: 60 * 60,
    refreshTtlSeconds: 7 * 24 * 60 * 60,
  });

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
    const adminExists = await loadAuthUserByEmail(tenantId, DEV_ADMIN_EMAIL);
    if (adminExists) {
      try {
        await syncAuthUserToPostgres(adminExists);
      } catch (err) {
        console.error("[web-portal] dev admin syncAuthUserToPostgres failed:", err);
      }
      return;
    }

    const legacyOwner = await loadAuthUserByEmail(tenantId, LEGACY_OWNER_EMAIL);
    if (legacyOwner) {
      await upsertUserRowFromAuthUser({
        ...legacyOwner,
        email: DEV_ADMIN_EMAIL,
        displayName: legacyOwner.displayName === "Seed Owner" ? "Seed Admin" : legacyOwner.displayName,
      });
      const migrated = await loadAuthUserByEmail(tenantId, DEV_ADMIN_EMAIL);
      if (migrated) {
        try {
          await syncAuthUserToPostgres(migrated);
        } catch (err) {
          console.error("[web-portal] dev admin migrate syncAuthUserToPostgres failed:", err);
        }
      }
      return;
    }

    const passwordHash = await hashPassword(DEV_OWNER_PASSWORD);
    const owner: import("@agenticx/auth").AuthUser = {
      id: "01J00000000000000000000004",
      tenantId,
      deptId: DEFAULT_DEPT_ID,
      email: DEV_ADMIN_EMAIL,
      displayName: "Seed Admin",
      passwordHash,
      mustChangePassword: false,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      scopes: getEffectiveUserScopes([]),
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
        console.error("[web-portal] dev admin sync after PG insert failed:", err);
      }
    }
  })();

  return {
    repo,
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

function createPortalSessionId(userId: string): string {
  return `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensurePortalSessionGrant(
  user: Pick<import("@agenticx/auth").AuthUser, "tenantId" | "email">,
  sessionId: string,
  ttlSeconds: number,
): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return;
  await createSessionGrant({
    tenantId: user.tenantId,
    sessionId,
    scopes: [...PORTAL_SESSION_GRANT_SCOPES],
    ttlSeconds,
    createdBy: user.email,
    description: "web-portal session access",
  });
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
    mustChangePassword: input.mustChangePassword ?? false,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    scopes: getEffectiveUserScopes(input.scopes),
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
  await reconcileConfiguredAdminPasswordIfNeeded(email, password);
  const user = await authenticatePortalUser(runtime, email, password);
  const tokens = await issueTokensForUser(runtime, user);
  try {
    await syncAuthUserToPostgres(user);
  } catch (err) {
    console.error("[web-portal] syncAuthUserToPostgres after login failed:", err);
  }
  return tokens;
}

/** Desktop device login: verify password then return identity fields (JWT discarded by caller). */
export async function loginAndGetIdentity(email: string, password: string): Promise<{
  userId: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
}> {
  const runtime = await getRuntime();
  await reconcileConfiguredAdminPasswordIfNeeded(email, password);
  const user = await authenticatePortalUser(runtime, email, password);
  if (user.mustChangePassword) {
    throw new Error("password_change_required");
  }
  try {
    await syncAuthUserToPostgres(user);
  } catch (err) {
    console.error("[web-portal] syncAuthUserToPostgres after desktop login failed:", err);
  }
  return {
    userId: user.id,
    tenantId: user.tenantId,
    deptId: user.deptId ?? null,
    email: user.email,
    displayName: user.displayName ?? "",
  };
}

type OidcLoginInput = {
  providerId: string;
  issuer: string;
  subject: string | null;
  email: string;
  displayName: string;
  deptHint?: string | null;
  roleCodeHints?: string[];
  protocol?: "oidc" | "saml";
};

type OidcLoginResult = {
  tokens: AuthTokens;
  userId: string;
  tenantId: string;
  jitCreated: boolean;
};

function parseDefaultSsoRoleCodes(): string[] {
  const configured = process.env.SSO_DEFAULT_ROLE_CODES?.trim();
  if (!configured) return ["member"];
  const parsed = configured
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : ["member"];
}

function parseJitRoleAllowlist(): Set<string> {
  const configured = process.env.SSO_JIT_ROLE_ALLOWLIST?.trim();
  if (!configured) {
    return new Set(parseDefaultSsoRoleCodes());
  }
  const parsed = configured
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parsed.length) return new Set(parseDefaultSsoRoleCodes());
  return new Set(parsed);
}

async function issueTokensForUser(runtime: AuthRuntime, user: import("@agenticx/auth").AuthUser): Promise<AuthTokens> {
  const context = buildPortalTokenContext(user, createPortalSessionId(user.id));
  const access = await runtime.jwtService.signAccessToken(context);
  const refresh = await runtime.jwtService.signRefreshToken(context);
  await runtime.refreshStore.set({
    sessionId: context.sessionId,
    userId: context.userId,
    tenantId: context.tenantId,
    deptId: context.deptId ?? null,
    email: context.email,
    scopes: context.scopes,
    mustChangePassword: context.mustChangePassword,
    expiresAt: Date.now() + refresh.expiresInSeconds * 1000,
  });
  try {
    await ensurePortalSessionGrant(user, context.sessionId, refresh.expiresInSeconds);
  } catch (error) {
    await runtime.refreshStore.delete(context.sessionId);
    throw error;
  }
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    tokenType: "Bearer",
    expiresInSeconds: access.expiresInSeconds,
    mustChangePassword: context.mustChangePassword,
  };
}

async function authenticatePortalUser(
  runtime: AuthRuntime,
  email: string,
  password: string,
): Promise<import("@agenticx/auth").AuthUser> {
  const user = await runtime.repo.findByEmail(email.trim().toLowerCase());
  if (!user) throw new Error("Invalid credentials.");
  if (user.status === "disabled") throw new Error("Account disabled.");
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    throw new Error("Account temporarily locked.");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failedCount = user.failedLoginCount + 1;
    const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = shouldLock ? Date.now() + LOCK_MINUTES * 60 * 1000 : null;
    await runtime.repo.updateFailedLogin(user.email, failedCount, lockedUntil);
    throw new Error("Invalid credentials.");
  }

  await runtime.repo.resetFailedLogin(user.email);
  return user;
}

export async function loginWithOidcClaims(input: OidcLoginInput): Promise<OidcLoginResult> {
  const runtime = await getRuntime();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("oidc.invalid_email");
  }
  if (!runtime.tenantId) {
    throw new Error("DEFAULT_TENANT_ID is required for OIDC login.");
  }

  let user = await runtime.repo.findByEmail(normalizedEmail);
  let jitCreated = false;
  let jitAssignedRoles: string[] | null = null;

  if (!user) {
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    const roleAllowlist = parseJitRoleAllowlist();
    const jitRoles = (input.roleCodeHints ?? []).filter((code) => roleAllowlist.has(code));
    const assignedRoles = jitRoles.length ? jitRoles : parseDefaultSsoRoleCodes();
    jitAssignedRoles = assignedRoles;
    const nextUser: import("@agenticx/auth").AuthUser = {
      id: ulid(),
      tenantId: runtime.tenantId,
      deptId: null,
      email: normalizedEmail,
      displayName: input.displayName.trim() || normalizedEmail,
      passwordHash,
      mustChangePassword: false,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      scopes: getEffectiveUserScopes([]),
    };
    await runtime.repo.upsertUser(nextUser);
    const orgId = process.env.DATABASE_URL?.trim() ? await getDefaultOrgId(runtime.tenantId) : null;
    await assignRolesIfNone({
      tenantId: runtime.tenantId,
      userId: nextUser.id,
      roleCodes: assignedRoles,
      defaultOrgId: orgId,
      defaultDeptId: null,
    });
    user = await runtime.repo.findByEmail(normalizedEmail);
    jitCreated = true;
  }

  if (!user) {
    throw new Error("oidc.user_not_found");
  }
  if (user.status === "disabled" || user.status === "locked" || (user.lockedUntil && user.lockedUntil > Date.now())) {
    throw new Error("oidc.account_disabled");
  }

  const auditProtocol = input.protocol ?? "oidc";
  if (jitCreated && jitAssignedRoles && process.env.DATABASE_URL?.trim()) {
    try {
      await insertAuditEvent({
        tenantId: user.tenantId,
        actorUserId: user.id,
        eventType: "auth.sso.jit_create",
        targetKind: "user",
        targetId: user.id,
        detail: sanitizeSsoAuditDetail({
          protocol: auditProtocol,
          provider: input.providerId,
          provider_id: input.providerId,
          issuer: input.issuer,
          external_subject: input.subject,
          sub: input.subject,
          email_lower: normalizedEmail,
          role_codes: jitAssignedRoles,
        }),
      });
    } catch (error) {
      console.error("[web-portal] insertAuditEvent auth.sso.jit_create failed:", error);
    }
  }

  if (process.env.DATABASE_URL?.trim()) {
    try {
      await insertAuditEvent({
        tenantId: user.tenantId,
        actorUserId: user.id,
        eventType: "auth.sso.login",
        targetKind: "user",
        targetId: user.id,
        detail: sanitizeSsoAuditDetail({
          protocol: auditProtocol,
          provider: input.providerId,
          provider_id: input.providerId,
          issuer: input.issuer,
          external_subject: input.subject,
          sub: input.subject,
          jit_created: jitCreated,
        }),
      });
    } catch (error) {
      console.error("[web-portal] insertAuditEvent auth.sso.login failed:", error);
    }
  }

  try {
    await syncAuthUserToPostgres(user);
  } catch (error) {
    console.error("[web-portal] syncAuthUserToPostgres after oidc login failed:", error);
  }

  const tokens = await issueTokensForUser(runtime, user);
  return {
    tokens,
    userId: user.id,
    tenantId: user.tenantId,
    jitCreated,
  };
}

export async function completeRequiredPasswordChange(
  context: AuthContext,
  newPassword: string,
): Promise<AuthTokens> {
  const runtime = await getRuntime();
  if (!context.mustChangePassword) {
    throw new Error("Password change is not required.");
  }

  const user = await runtime.repo.updatePasswordAndClearRequirement(
    context.email,
    await hashPassword(newPassword),
  );
  if (!user || user.tenantId !== context.tenantId) {
    throw new Error("Account unavailable.");
  }

  await runtime.refreshStore.delete(context.sessionId);
  const tokens = await issueTokensForUser(runtime, user);
  try {
    await syncAuthUserToPostgres(user);
  } catch (error) {
    console.error("[web-portal] syncAuthUserToPostgres after password change failed:", error);
  }
  return tokens;
}

export async function verifyAccessToken(accessToken: string): Promise<AuthContext | null> {
  const runtime = await getRuntime();
  return runtime.jwtService.verifyAccessToken(accessToken);
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

  const nextContext = buildPortalTokenContext(user, createPortalSessionId(user.id));

  const access = await runtime.jwtService.signAccessToken(nextContext);
  const nextRefresh = await runtime.jwtService.signRefreshToken(nextContext);

  await runtime.refreshStore.set({
    ...stored,
    sessionId: nextContext.sessionId,
    userId: nextContext.userId,
    tenantId: nextContext.tenantId,
    email: nextContext.email,
    scopes: nextContext.scopes,
    deptId: nextContext.deptId ?? null,
    mustChangePassword: nextContext.mustChangePassword,
    expiresAt: Date.now() + nextRefresh.expiresInSeconds * 1000,
  });
  try {
    await ensurePortalSessionGrant(user, nextContext.sessionId, nextRefresh.expiresInSeconds);
  } catch (error) {
    await runtime.refreshStore.delete(nextContext.sessionId);
    throw error;
  }
  await runtime.refreshStore.delete(refreshContext.sessionId);

  return {
    accessToken: access.token,
    refreshToken: nextRefresh.token,
    tokenType: "Bearer",
    expiresInSeconds: access.expiresInSeconds,
    mustChangePassword: nextContext.mustChangePassword,
  };
}

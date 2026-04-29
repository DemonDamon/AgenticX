import {
  AuthService,
  InMemoryRefreshTokenStore,
  JwtService,
  hashPassword,
  type AuthContext,
  type AuthTokens,
  type AuthUser,
  type AuthUserRepository,
} from "@agenticx/auth";

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID;
const DEFAULT_DEPT_ID = process.env.DEFAULT_DEPT_ID;
const ENABLE_DEV_BOOTSTRAP = process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_BOOTSTRAP === "true";
const DEV_OWNER_PASSWORD = process.env.AUTH_DEV_OWNER_PASSWORD;
const WEAK_PASSWORDS = new Set(["admin123", "admin123!", "password", "password123", "qwerty123"]);
const OWNER_DEFAULT_SCOPES = [
  "workspace:chat",
  "user:create",
  "user:read",
  "user:update",
  "user:delete",
  "role:read",
  "dept:read",
  "audit:read",
];

type ProvisionInput = {
  tenantId: string;
  deptId?: string | null;
  email: string;
  displayName: string;
  password: string;
  scopes?: string[];
};

class SharedAuthUserRepository implements AuthUserRepository {
  private readonly users = new Map<string, AuthUser>();

  public async upsert(user: AuthUser): Promise<void> {
    const emailKey = user.email.toLowerCase();
    const existing = this.users.get(emailKey);
    if (existing && existing.tenantId !== user.tenantId) {
      throw new Error("email already exists in another tenant");
    }
    this.users.set(emailKey, user);
  }

  public async findByEmail(email: string): Promise<AuthUser | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }

  public async updateFailedLogin(email: string, nextFailedCount: number, lockedUntil: number | null): Promise<void> {
    const current = this.users.get(email.toLowerCase());
    if (!current) return;
    this.users.set(email.toLowerCase(), {
      ...current,
      failedLoginCount: nextFailedCount,
      lockedUntil,
      status: lockedUntil && lockedUntil > Date.now() ? "locked" : current.status,
    });
  }

  public async resetFailedLogin(email: string): Promise<void> {
    const current = this.users.get(email.toLowerCase());
    if (!current) return;
    this.users.set(email.toLowerCase(), {
      ...current,
      failedLoginCount: 0,
      lockedUntil: null,
      status: current.status === "locked" ? "active" : current.status,
    });
  }
}

type AuthRuntime = {
  repo: SharedAuthUserRepository;
  authService: AuthService;
  refreshStore: InMemoryRefreshTokenStore;
  bootstrapPromise: Promise<void>;
};

declare global {
  var __agenticxWebPortalAuthRuntime: AuthRuntime | undefined;
}

function createRuntime(): AuthRuntime {
  const repo = new SharedAuthUserRepository();
  const refreshStore = new InMemoryRefreshTokenStore();
  const jwtService = new JwtService({
    issuer: "agenticx-enterprise-web-portal",
    audience: "agenticx-web-users",
    accessTtlSeconds: 60 * 60,
    refreshTtlSeconds: 7 * 24 * 60 * 60,
  });
  const authService = new AuthService({ userRepo: repo, jwtService, refreshStore });

  const bootstrapPromise = (async () => {
    if (!ENABLE_DEV_BOOTSTRAP) {
      return;
    }
    if (!DEV_OWNER_PASSWORD) {
      throw new Error("AUTH_DEV_OWNER_PASSWORD is required when ENABLE_DEV_BOOTSTRAP=true.");
    }
    if (!DEFAULT_TENANT_ID || !DEFAULT_DEPT_ID) {
      throw new Error("DEFAULT_TENANT_ID and DEFAULT_DEPT_ID are required when ENABLE_DEV_BOOTSTRAP=true.");
    }
    if (!isStrongBootstrapPassword(DEV_OWNER_PASSWORD)) {
      throw new Error("AUTH_DEV_OWNER_PASSWORD must include upper/lower/number/symbol and be at least 14 chars.");
    }
    const exists = await repo.findByEmail("owner@agenticx.local");
    if (exists) {
      // Dev runtime may keep an old in-memory user across HMR; ensure owner can use chat.
      if (!exists.scopes.includes("workspace:chat")) {
        await repo.upsert({
          ...exists,
          scopes: Array.from(new Set([...exists.scopes, "workspace:chat"])),
        });
      }
      return;
    }
    const passwordHash = await hashPassword(DEV_OWNER_PASSWORD);
    await repo.upsert({
      id: "01J00000000000000000000004",
      tenantId: DEFAULT_TENANT_ID,
      deptId: DEFAULT_DEPT_ID,
      email: "owner@agenticx.local",
      displayName: "Seed Owner",
      passwordHash,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      scopes: OWNER_DEFAULT_SCOPES,
    });
  })();

  return {
    repo,
    authService,
    refreshStore,
    bootstrapPromise,
  };
}

async function ensureDevOwnerChatScope(repo: SharedAuthUserRepository): Promise<void> {
  if (!ENABLE_DEV_BOOTSTRAP) return;
  const owner = await repo.findByEmail("owner@agenticx.local");
  if (!owner || owner.scopes.includes("workspace:chat")) return;
  await repo.upsert({
    ...owner,
    scopes: Array.from(new Set([...owner.scopes, "workspace:chat"])),
  });
}

async function getRuntime(): Promise<AuthRuntime> {
  globalThis.__agenticxWebPortalAuthRuntime ??= createRuntime();
  await globalThis.__agenticxWebPortalAuthRuntime.bootstrapPromise;
  await ensureDevOwnerChatScope(globalThis.__agenticxWebPortalAuthRuntime.repo);
  return globalThis.__agenticxWebPortalAuthRuntime;
}

function buildUserId(email: string): string {
  return `user_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
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

export async function provisionUserFromAdmin(input: ProvisionInput): Promise<void> {
  const runtime = await getRuntime();
  const passwordHash = await hashPassword(input.password);
  await runtime.repo.upsert({
    id: buildUserId(input.email),
    tenantId: input.tenantId,
    deptId: input.deptId ?? null,
    email: input.email.toLowerCase(),
    displayName: input.displayName,
    passwordHash,
    status: "active",
    failedLoginCount: 0,
    lockedUntil: null,
    scopes: input.scopes ?? ["workspace:chat", "user:read"],
  });
}

export async function loginWithPassword(email: string, password: string): Promise<AuthTokens> {
  const runtime = await getRuntime();
  return runtime.authService.loginWithPassword({ email, password });
}

export async function verifyAccessToken(accessToken: string): Promise<AuthContext | null> {
  const runtime = await getRuntime();
  return runtime.authService.verifyAccess(accessToken);
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const runtime = await getRuntime();
  return runtime.authService.refresh(refreshToken);
}


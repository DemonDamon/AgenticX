import { JwtService } from "./jwt";
import { verifyPassword } from "./password";
import type {
  AuthContext,
  AuthTokens,
  AuthUser,
  AuthUserRepository,
  LoginInput,
  RefreshSession,
  RefreshTokenStore,
} from "../types";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly sessions = new Map<string, RefreshSession>();

  public async set(session: RefreshSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  public async get(sessionId: string): Promise<RefreshSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  public async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export class InMemoryAuthUserRepository implements AuthUserRepository {
  private readonly users = new Map<string, AuthUser>();

  public constructor(seedUsers: AuthUser[] = []) {
    for (const user of seedUsers) {
      this.users.set(user.email.toLowerCase(), user);
    }
  }

  public async findByEmail(email: string): Promise<AuthUser | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }

  public async updateFailedLogin(email: string, nextFailedCount: number, lockedUntil: number | null): Promise<void> {
    const key = email.toLowerCase();
    const current = this.users.get(key);
    if (!current) return;
    this.users.set(key, {
      ...current,
      failedLoginCount: nextFailedCount,
      lockedUntil,
      status: lockedUntil && lockedUntil > Date.now() ? "locked" : current.status,
    });
  }

  public async resetFailedLogin(email: string): Promise<void> {
    const key = email.toLowerCase();
    const current = this.users.get(key);
    if (!current) return;
    this.users.set(key, {
      ...current,
      failedLoginCount: 0,
      lockedUntil: null,
      status: current.status === "locked" ? "active" : current.status,
    });
  }
}

type AuthServiceDeps = {
  userRepo: AuthUserRepository;
  jwtService: JwtService;
  refreshStore?: RefreshTokenStore;
};

export class AuthService {
  private readonly userRepo: AuthUserRepository;
  private readonly jwtService: JwtService;
  private readonly refreshStore: RefreshTokenStore;

  public constructor(deps: AuthServiceDeps) {
    this.userRepo = deps.userRepo;
    this.jwtService = deps.jwtService;
    this.refreshStore = deps.refreshStore ?? new InMemoryRefreshTokenStore();
  }

  private toContext(user: AuthUser): AuthContext {
    return {
      userId: user.id,
      tenantId: user.tenantId,
      deptId: user.deptId ?? null,
      email: user.email,
      scopes: user.scopes,
      sessionId: `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  public async loginWithPassword(input: LoginInput): Promise<AuthTokens> {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) throw new Error("Invalid credentials.");
    if (user.status === "disabled") throw new Error("Account disabled.");
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      throw new Error("Account temporarily locked.");
    }

    const isValidPassword = await verifyPassword(input.password, user.passwordHash);
    if (!isValidPassword) {
      const failedCount = user.failedLoginCount + 1;
      const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = shouldLock ? Date.now() + LOCK_MINUTES * 60 * 1000 : null;
      await this.userRepo.updateFailedLogin(user.email, failedCount, lockedUntil);
      throw new Error("Invalid credentials.");
    }

    await this.userRepo.resetFailedLogin(user.email);
    const context = this.toContext(user);
    const access = await this.jwtService.signAccessToken(context);
    const refresh = await this.jwtService.signRefreshToken(context);

    await this.refreshStore.set({
      sessionId: context.sessionId,
      userId: context.userId,
      tenantId: context.tenantId,
      deptId: context.deptId ?? null,
      email: context.email,
      scopes: context.scopes,
      expiresAt: Date.now() + refresh.expiresInSeconds * 1000,
    });

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: "Bearer",
      expiresInSeconds: access.expiresInSeconds,
    };
  }

  public async verifyAccess(token: string): Promise<AuthContext | null> {
    return this.jwtService.verifyAccessToken(token);
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const refreshContext = await this.jwtService.verifyRefreshToken(refreshToken);
    if (!refreshContext) throw new Error("Invalid refresh token.");

    const stored = await this.refreshStore.get(refreshContext.sessionId);
    if (!stored || stored.userId !== refreshContext.userId || stored.tenantId !== refreshContext.tenantId) {
      throw new Error("Refresh session expired.");
    }

    const access = await this.jwtService.signAccessToken(refreshContext);
    const nextRefresh = await this.jwtService.signRefreshToken(refreshContext);

    await this.refreshStore.set({
      ...stored,
      expiresAt: Date.now() + nextRefresh.expiresInSeconds * 1000,
    });

    return {
      accessToken: access.token,
      refreshToken: nextRefresh.token,
      tokenType: "Bearer",
      expiresInSeconds: access.expiresInSeconds,
    };
  }
}


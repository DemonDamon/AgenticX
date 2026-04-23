export type AuthUser = {
  id: string;
  tenantId: string;
  deptId?: string | null;
  email: string;
  displayName: string;
  passwordHash: string;
  status: "active" | "disabled" | "locked";
  failedLoginCount: number;
  lockedUntil?: number | null;
  scopes: string[];
};

export type AuthContext = {
  userId: string;
  tenantId: string;
  deptId?: string | null;
  email: string;
  scopes: string[];
  sessionId: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RefreshSession = {
  sessionId: string;
  userId: string;
  tenantId: string;
  deptId?: string | null;
  email: string;
  scopes: string[];
  expiresAt: number;
};

export interface RefreshTokenStore {
  set(session: RefreshSession): Promise<void>;
  get(sessionId: string): Promise<RefreshSession | null>;
  delete(sessionId: string): Promise<void>;
}

export interface AuthUserRepository {
  findByEmail(email: string): Promise<AuthUser | null>;
  updateFailedLogin(email: string, nextFailedCount: number, lockedUntil: number | null): Promise<void>;
  resetFailedLogin(email: string): Promise<void>;
}


import { AuthService } from "../services/auth";
import type { AuthContext, AuthTokens, LoginInput } from "../types";
import type { AuthProvider } from "./types";

export class PasswordProvider implements AuthProvider {
  public readonly kind = "password" as const;
  private readonly authService: AuthService;

  public constructor(authService: AuthService) {
    this.authService = authService;
  }

  public async login(input: LoginInput): Promise<AuthTokens> {
    return this.authService.loginWithPassword(input);
  }

  public async logout(_sessionId: string): Promise<void> {
    // 本期仅实现账密登录主流程，logout 由 refresh-token 回收逻辑在后续版本完善。
  }

  public async getClaims(accessToken: string): Promise<AuthContext | null> {
    return this.authService.verifyAccess(accessToken);
  }
}


import type { AuthContext, AuthTokens, LoginInput } from "../types";

export type AuthProviderKind = "password" | "oidc" | "saml";

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  login(input: LoginInput): Promise<AuthTokens>;
  logout(sessionId: string): Promise<void>;
  getClaims(accessToken: string): Promise<AuthContext | null>;
}


import type { AuthContext, AuthTokens, LoginInput } from "../types";
import type { AuthProvider } from "./types";

export class SamlProvider implements AuthProvider {
  public readonly kind = "saml" as const;

  public async login(_input: LoginInput): Promise<AuthTokens> {
    throw new Error("SAML provider is not implemented in current phase.");
  }

  public async logout(_sessionId: string): Promise<void> {
    throw new Error("SAML provider is not implemented in current phase.");
  }

  public async getClaims(_accessToken: string): Promise<AuthContext | null> {
    throw new Error("SAML provider is not implemented in current phase.");
  }
}


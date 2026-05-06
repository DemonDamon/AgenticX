import { OidcCallbackError, OidcClientService, type OidcExchangeResult, type OidcProviderConfig } from "../services/oidc-client";
import type { AuthContext, AuthTokens, LoginInput } from "../types";
import type { AuthProvider } from "./types";

export class OidcProvider implements AuthProvider {
  public readonly kind = "oidc" as const;
  private readonly oidcClient: OidcClientService;

  public constructor(oidcClient?: OidcClientService) {
    this.oidcClient = oidcClient ?? new OidcClientService();
  }

  public async buildAuthorizationUrl(input: {
    provider: OidcProviderConfig;
    state: string;
    nonce: string;
    codeVerifier: string;
    returnTo?: string;
  }): Promise<string> {
    return this.oidcClient.buildAuthorizationUrl(input);
  }

  public async exchangeCallback(input: {
    provider: OidcProviderConfig;
    callbackUrl: string;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<OidcExchangeResult> {
    return this.oidcClient.exchangeCallback(input);
  }

  public async login(_input: LoginInput): Promise<AuthTokens> {
    throw new OidcCallbackError(
      "oidc.unsupported_operation",
      "OIDC provider does not support password-style login() directly."
    );
  }

  public async logout(_sessionId: string): Promise<void> {
    // Single logout handled by the application layer.
  }

  public async getClaims(_accessToken: string): Promise<AuthContext | null> {
    // Access token claims are usually resolved by upstream OIDC provider.
    return null;
  }
}


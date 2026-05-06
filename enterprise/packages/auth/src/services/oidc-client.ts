import * as oidc from "openid-client";
import type { ClaimMapping } from "./oidc-claims";
import { mapClaimsToAuthUser } from "./oidc-claims";

const DISCOVERY_CACHE_TTL_MS = 60 * 1000;
const DISCOVERY_CACHE_STALE_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type OidcModule = {
  discovery?: (...args: unknown[]) => Promise<unknown>;
  buildAuthorizationUrl?: (...args: unknown[]) => URL | Promise<URL>;
  authorizationCodeGrant?: (...args: unknown[]) => Promise<unknown>;
  randomPKCECodeVerifier?: () => string;
  calculatePKCECodeChallenge?: (codeVerifier: string) => Promise<string> | string;
  getValidatedIdTokenClaims?: (tokens: unknown) => Record<string, unknown>;
};

export type OidcProviderConfig = {
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
  postLogoutRedirectUri?: string;
  claimMapping?: ClaimMapping;
};

export type BuildAuthorizationUrlInput = {
  provider: OidcProviderConfig;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo?: string;
};

export type ExchangeCallbackInput = {
  provider: OidcProviderConfig;
  callbackUrl: string;
  expectedState: string;
  expectedNonce: string;
  codeVerifier: string;
};

export type OidcExchangeResult = {
  claims: Record<string, unknown>;
  mapped: ReturnType<typeof mapClaimsToAuthUser>;
  rawTokens: unknown;
};

export class OidcConfigError extends Error {
  public constructor(public readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "OidcConfigError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class OidcCallbackError extends Error {
  public constructor(public readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "OidcCallbackError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

function normalizeScopes(scopes: string[] | undefined): string {
  const list = scopes?.length ? scopes : ["openid", "profile", "email"];
  return list.join(" ");
}

function requireOidcFunction<T extends keyof OidcModule>(name: T): NonNullable<OidcModule[T]> {
  const api = oidc as OidcModule;
  const fn = api[name];
  if (!fn) {
    throw new OidcConfigError("oidc.unsupported_runtime", `openid-client missing function: ${name as string}`);
  }
  return fn;
}

function toUnknownRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

export class OidcClientService {
  private readonly cache = new Map<
    string,
    { configuration: unknown; expireAt: number; firstFetchedAt: number }
  >();

  private cacheKey(provider: OidcProviderConfig): string {
    return `${provider.providerId}:${provider.issuer}:${provider.clientId}`;
  }

  public invalidateProvider(providerId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${providerId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  public async getConfiguration(provider: OidcProviderConfig): Promise<unknown> {
    const key = this.cacheKey(provider);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expireAt > now) {
      return cached.configuration;
    }

    const discovery = requireOidcFunction("discovery");
    try {
      const configuration = await discovery(
        new URL(provider.issuer),
        provider.clientId,
        provider.clientSecret ? { client_secret: provider.clientSecret } : undefined
      );
      this.cache.set(key, {
        configuration,
        expireAt: now + DISCOVERY_CACHE_TTL_MS,
        firstFetchedAt: cached?.firstFetchedAt ?? now,
      });
      return configuration;
    } catch (error) {
      if (cached) {
        const staleAgeMs = now - cached.firstFetchedAt;
        if (staleAgeMs <= DISCOVERY_CACHE_STALE_FALLBACK_MAX_AGE_MS) {
          console.warn("[oidc] discovery failed, fallback stale cache", {
            providerId: provider.providerId,
            issuer: provider.issuer,
            staleAgeMs,
          });
          return cached.configuration;
        }
        this.cache.delete(key);
        console.error("[oidc] discovery failed and stale cache exceeded max age, dropping", {
          providerId: provider.providerId,
          issuer: provider.issuer,
          staleAgeMs,
          maxAgeMs: DISCOVERY_CACHE_STALE_FALLBACK_MAX_AGE_MS,
        });
      }
      throw new OidcConfigError("oidc.discovery_failed", "Failed to discover OIDC metadata.", { cause: error });
    }
  }

  public createCodeVerifier(): string {
    const fn = requireOidcFunction("randomPKCECodeVerifier");
    return fn();
  }

  public async createCodeChallenge(codeVerifier: string): Promise<string> {
    const fn = requireOidcFunction("calculatePKCECodeChallenge");
    const result = await fn(codeVerifier);
    return `${result}`;
  }

  public async buildAuthorizationUrl(input: BuildAuthorizationUrlInput): Promise<string> {
    const config = await this.getConfiguration(input.provider);
    const buildAuthorizationUrl = requireOidcFunction("buildAuthorizationUrl");
    const codeChallenge = await this.createCodeChallenge(input.codeVerifier);
    const authorization = await buildAuthorizationUrl(config, {
      redirect_uri: input.provider.redirectUri,
      response_type: "code",
      scope: normalizeScopes(input.provider.scopes),
      state: input.state,
      nonce: input.nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${authorization}`;
  }

  public async exchangeCallback(input: ExchangeCallbackInput): Promise<OidcExchangeResult> {
    const config = await this.getConfiguration(input.provider);
    const grant = requireOidcFunction("authorizationCodeGrant");
    const claimsFn = requireOidcFunction("getValidatedIdTokenClaims");

    try {
      const tokens = await grant(config, new URL(input.callbackUrl), {
        pkceCodeVerifier: input.codeVerifier,
        expectedState: input.expectedState,
        expectedNonce: input.expectedNonce,
      });
      const claims = toUnknownRecord(claimsFn(tokens));
      const mapped = mapClaimsToAuthUser(claims, input.provider.claimMapping);
      return { claims, mapped, rawTokens: tokens };
    } catch (error) {
      throw new OidcCallbackError("oidc.callback_failed", "Failed to exchange OIDC callback.", { cause: error });
    }
  }
}

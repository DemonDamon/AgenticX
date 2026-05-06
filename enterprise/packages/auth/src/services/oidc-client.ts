import * as oidc from "openid-client";
import { type ClaimMapping, mapClaimsToAuthUser, OidcClaimError } from "./oidc-claims";
import { assertOidcRedirectUriForRuntime, OidcInvalidRedirectError } from "./oidc-redirect-policy";

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

export type OidcDiscoveryDegradedDetail = {
  providerId: string;
  issuer: string;
  consecutiveStaleCount: number;
};

let discoveryDegradedReporter: ((detail: OidcDiscoveryDegradedDetail) => void | Promise<void>) | undefined;

/** Register handler for consecutive discovery failures falling back to stale cache (FR-B2.3). */
export function registerOidcDiscoveryDegradedReporter(
  fn: (detail: OidcDiscoveryDegradedDetail) => void | Promise<void>
): void {
  discoveryDegradedReporter = fn;
}

export type OidcCacheStatsGlobal = {
  hits: number;
  misses: number;
  staleHits: number;
  staleEvictions: number;
  lastError: string | null;
};

export type OidcCacheStatsByProvider = Record<
  string,
  { hits: number; misses: number; staleHits: number; staleEvictions: number }
>;

export class OidcClientService {
  private readonly cache = new Map<
    string,
    { configuration: unknown; expireAt: number; firstFetchedAt: number }
  >();

  private readonly consecutiveStaleByProvider = new Map<string, number>();

  private readonly globalStats: OidcCacheStatsGlobal = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    staleEvictions: 0,
    lastError: null,
  };

  private readonly providerStats = new Map<string, { hits: number; misses: number; staleHits: number; staleEvictions: number }>();

  private bumpProviderStat(
    providerId: string,
    key: "hits" | "misses" | "staleHits" | "staleEvictions",
    delta = 1
  ): void {
    const cur = this.providerStats.get(providerId) ?? { hits: 0, misses: 0, staleHits: 0, staleEvictions: 0 };
    cur[key] += delta;
    this.providerStats.set(providerId, cur);
  }

  public getOidcCacheStats(): { global: OidcCacheStatsGlobal; byProvider: OidcCacheStatsByProvider } {
    return {
      global: { ...this.globalStats },
      byProvider: Object.fromEntries(this.providerStats.entries()),
    };
  }

  private cacheKey(provider: OidcProviderConfig): string {
    return `${provider.providerId}:${provider.issuer}:${provider.clientId}`;
  }

  public invalidateProvider(providerId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${providerId}:`)) {
        this.cache.delete(key);
      }
    }
    this.consecutiveStaleByProvider.delete(providerId);
  }

  public async getConfiguration(provider: OidcProviderConfig): Promise<unknown> {
    const key = this.cacheKey(provider);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expireAt > now) {
      this.globalStats.hits += 1;
      this.bumpProviderStat(provider.providerId, "hits");
      return cached.configuration;
    }

    this.globalStats.misses += 1;
    this.bumpProviderStat(provider.providerId, "misses");

    const discovery = requireOidcFunction("discovery");
    try {
      const configuration = await discovery(
        new URL(provider.issuer),
        provider.clientId,
        provider.clientSecret ? { client_secret: provider.clientSecret } : undefined
      );
      this.consecutiveStaleByProvider.delete(provider.providerId);
      this.cache.set(key, {
        configuration,
        expireAt: now + DISCOVERY_CACHE_TTL_MS,
        firstFetchedAt: cached?.firstFetchedAt ?? now,
      });
      return configuration;
    } catch (error) {
      this.globalStats.lastError = error instanceof Error ? error.message : String(error);
      if (cached) {
        const staleAgeMs = now - cached.firstFetchedAt;
        if (staleAgeMs <= DISCOVERY_CACHE_STALE_FALLBACK_MAX_AGE_MS) {
          console.warn("[oidc] discovery failed, fallback stale cache", {
            providerId: provider.providerId,
            issuer: provider.issuer,
            staleAgeMs,
          });
          this.globalStats.staleHits += 1;
          this.bumpProviderStat(provider.providerId, "staleHits");
          const n = (this.consecutiveStaleByProvider.get(provider.providerId) ?? 0) + 1;
          this.consecutiveStaleByProvider.set(provider.providerId, n);
          if (n >= 5) {
            this.consecutiveStaleByProvider.set(provider.providerId, 0);
            void discoveryDegradedReporter?.({
              providerId: provider.providerId,
              issuer: provider.issuer,
              consecutiveStaleCount: n,
            });
          }
          return cached.configuration;
        }
        this.cache.delete(key);
        this.globalStats.staleEvictions += 1;
        this.bumpProviderStat(provider.providerId, "staleEvictions");
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
    try {
      assertOidcRedirectUriForRuntime(input.provider.redirectUri);
    } catch (e) {
      if (e instanceof OidcInvalidRedirectError) {
        throw new OidcConfigError(e.code, e.message);
      }
      throw e;
    }
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
    try {
      assertOidcRedirectUriForRuntime(input.provider.redirectUri);
    } catch (e) {
      if (e instanceof OidcInvalidRedirectError) {
        throw new OidcConfigError(e.code, e.message);
      }
      throw e;
    }
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
      if (error instanceof OidcClaimError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const lower = msg.toLowerCase();
      if (lower.includes("nonce") || lower.includes("expected nonce")) {
        throw new OidcCallbackError("oidc.invalid_nonce", "ID token nonce validation failed.", { cause: error });
      }
      if (/(401|unauthorized|invalid_client)/i.test(msg)) {
        throw new OidcCallbackError("oidc.callback_failed", "Token endpoint rejected the authorization code.", {
          cause: error,
        });
      }
      throw new OidcCallbackError("oidc.callback_failed", "Failed to exchange OIDC callback.", { cause: error });
    }
  }
}

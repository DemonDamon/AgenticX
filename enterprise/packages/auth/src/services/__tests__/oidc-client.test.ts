import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OidcClientService, registerOidcDiscoveryDegradedReporter } from "../oidc-client";
import { buildStateCookieValue, validateStateFromCookie } from "../oidc-state";

const mockDiscovery = vi.fn();
const mockBuildAuthorizationUrl = vi.fn();
const mockAuthorizationCodeGrant = vi.fn();
const mockGetValidatedIdTokenClaims = vi.fn();
const mockRandomVerifier = vi.fn();
const mockChallenge = vi.fn();

vi.mock("openid-client", () => ({
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
  getValidatedIdTokenClaims: (...args: unknown[]) => mockGetValidatedIdTokenClaims(...args),
  randomPKCECodeVerifier: () => mockRandomVerifier(),
  calculatePKCECodeChallenge: (...args: unknown[]) => mockChallenge(...args),
}));

describe("OidcClientService", () => {
  const service = new OidcClientService();
  const provider = {
    providerId: "default",
    issuer: "https://idp.example.com/realms/agenticx",
    clientId: "agenticx-portal",
    clientSecret: "secret",
    redirectUri: "https://portal.example.com/api/auth/sso/oidc/callback",
    scopes: ["openid", "profile", "email", "groups"],
    claimMapping: { roles: "groups" },
  };

  beforeEach(() => {
    mockDiscovery.mockReset();
    mockBuildAuthorizationUrl.mockReset();
    mockAuthorizationCodeGrant.mockReset();
    mockGetValidatedIdTokenClaims.mockReset();
    mockRandomVerifier.mockReset();
    mockChallenge.mockReset();
  });

  it("builds authorization URL with PKCE", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockChallenge.mockResolvedValue("challenge-value");
    mockBuildAuthorizationUrl.mockReturnValue(
      new URL(
        "https://idp.example.com/auth?response_type=code&client_id=agenticx-portal&state=state-1&nonce=nonce-1"
      )
    );

    const url = await service.buildAuthorizationUrl({
      provider,
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
      returnTo: "/workspace",
    });

    expect(url).toContain("state=state-1");
    expect(mockBuildAuthorizationUrl).toHaveBeenCalledTimes(1);
    expect(mockBuildAuthorizationUrl.mock.calls[0]?.[1]).toMatchObject({
      state: "state-1",
      nonce: "nonce-1",
      code_challenge: "challenge-value",
      code_challenge_method: "S256",
    });
  });

  it("exchanges callback and maps id_token claims", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: "token-1" });
    mockGetValidatedIdTokenClaims.mockReturnValue({
      sub: "oidc-sub",
      email: "owner@agenticx.local",
      name: "Owner",
      groups: ["member", "policy_admin"],
    });

    const result = await service.exchangeCallback({
      provider,
      callbackUrl: "https://portal.example.com/api/auth/sso/oidc/callback?code=abc&state=s1",
      expectedState: "s1",
      expectedNonce: "n1",
      codeVerifier: "v1",
    });

    expect(result.mapped.email).toBe("owner@agenticx.local");
    expect(result.mapped.roleCodeHints).toEqual(["member", "policy_admin"]);
  });

  it("validates signed state cookie and rejects mismatch", () => {
    const stateSecret = randomBytes(32).toString("hex");
    const { cookieValue, state } = buildStateCookieValue(
      { providerId: "default", returnTo: "/workspace", ttlMs: 5_000 },
      stateSecret
    );
    expect(cookieValue).not.toContain("default");
    expect(cookieValue).not.toContain("/workspace");
    expect(cookieValue).not.toContain(state.codeVerifier);

    const decoded = validateStateFromCookie(cookieValue, state.state, stateSecret);
    expect(decoded.providerId).toBe("default");

    expect(() =>
      validateStateFromCookie(cookieValue, "another-state", stateSecret)
    ).toThrowError("oidc.invalid_state");
  });

  it("maps token endpoint 401 to oidc.callback_failed (FR-C1.1)", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockAuthorizationCodeGrant.mockRejectedValue(new Error("401 unauthorized"));

    await expect(
      service.exchangeCallback({
        provider,
        callbackUrl: "https://portal.example.com/api/auth/sso/oidc/callback?code=abc&state=s1",
        expectedState: "s1",
        expectedNonce: "n1",
        codeVerifier: "v1",
      })
    ).rejects.toMatchObject({ code: "oidc.callback_failed" });
  });

  it("maps nonce validation failure to oidc.invalid_nonce (FR-C1.1)", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: "t" });
    mockGetValidatedIdTokenClaims.mockImplementation(() => {
      throw new Error("expected nonce mismatch");
    });

    await expect(
      service.exchangeCallback({
        provider,
        callbackUrl: "https://portal.example.com/api/auth/sso/oidc/callback?code=abc&state=s1",
        expectedState: "s1",
        expectedNonce: "n1",
        codeVerifier: "v1",
      })
    ).rejects.toMatchObject({ code: "oidc.invalid_nonce" });
  });

  it("fires discovery degraded reporter after 5 consecutive stale fallbacks (AC-B2.1 / FR-C1.1)", async () => {
    const degraded = vi.fn();
    registerOidcDiscoveryDegradedReporter(degraded);
    const local = new OidcClientService();
    mockDiscovery.mockResolvedValueOnce({ issuer: provider.issuer });

    vi.useFakeTimers();
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    await local.getConfiguration(provider);

    vi.setSystemTime(t0 + 61_000);
    mockDiscovery.mockRejectedValue(new Error("discovery down"));

    for (let i = 0; i < 5; i++) {
      await local.getConfiguration(provider);
    }

    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded.mock.calls[0]?.[0]).toMatchObject({
      providerId: provider.providerId,
      consecutiveStaleCount: 5,
    });

    const stats = local.getOidcCacheStats();
    expect(stats.global.staleHits).toBe(5);

    vi.useRealTimers();
  });

  it("evicts stale discovery cache past max age and throws oidc.discovery_failed", async () => {
    const local = new OidcClientService();
    mockDiscovery.mockResolvedValueOnce({ issuer: provider.issuer });

    vi.useFakeTimers();
    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);
    await local.getConfiguration(provider);

    vi.setSystemTime(t0 + 61_000);
    mockDiscovery.mockRejectedValue(new Error("discovery down"));
    await local.getConfiguration(provider);

    vi.setSystemTime(t0 + 3_600_000 + 60_000);
    mockDiscovery.mockRejectedValue(new Error("discovery still down"));

    await expect(local.getConfiguration(provider)).rejects.toMatchObject({ code: "oidc.discovery_failed" });
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OidcClientService } from "../oidc-client";
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
});

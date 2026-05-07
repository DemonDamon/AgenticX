import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OidcProtocolHandler } from "../oidc-protocol-handler";

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

const provider = {
  providerId: "default",
  issuer: "https://idp.example.com/realms/agenticx",
  clientId: "agenticx-portal",
  clientSecret: "secret",
  redirectUri: "https://portal.example.com/api/auth/sso/oidc/callback",
  scopes: ["openid", "profile", "email"],
  claimMapping: { roles: "groups" },
};

describe("OidcProtocolHandler", () => {
  beforeEach(() => {
    mockDiscovery.mockReset();
    mockBuildAuthorizationUrl.mockReset();
    mockAuthorizationCodeGrant.mockReset();
    mockGetValidatedIdTokenClaims.mockReset();
    mockRandomVerifier.mockReset();
    mockChallenge.mockReset();
  });

  it("startAuthentication returns redirect + signed state cookie", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockChallenge.mockResolvedValue("challenge-value");
    mockRandomVerifier.mockReturnValue("pkce-verifier");
    mockBuildAuthorizationUrl.mockReturnValue(
      new URL("https://idp.example.com/auth?response_type=code&client_id=agenticx-portal")
    );

    const handler = new OidcProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");

    const result = await handler.startAuthentication({
      provider,
      cookieSecret,
      returnTo: "/workspace",
    });

    expect(result.kind).toBe("redirect");
    expect(result.protocol).toBe("oidc");
    expect(result.redirectUrl).toContain("https://idp.example.com/auth");
    expect(result.cookie?.value).toBeTruthy();
    expect(result.cookie?.value).not.toContain("default");
    expect(result.cookie?.maxAgeSeconds).toBeGreaterThan(0);
    expect(result.state.providerId).toBe("default");
    expect(result.state.returnTo).toBe("/workspace");
  });

  it("handleCallback validates state cookie and returns SsoExternalIdentity", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockChallenge.mockResolvedValue("challenge-value");
    mockRandomVerifier.mockReturnValue("pkce-verifier");
    mockBuildAuthorizationUrl.mockReturnValue(
      new URL("https://idp.example.com/auth?response_type=code")
    );
    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: "tok" });
    mockGetValidatedIdTokenClaims.mockReturnValue({
      sub: "oidc-sub",
      email: "owner@agenticx.local",
      name: "Owner",
      groups: ["member", "policy_admin"],
    });

    const handler = new OidcProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      returnTo: "/workspace",
    });

    const result = await handler.handleCallback({
      provider,
      cookieSecret,
      cookieValue: start.cookie?.value,
      callbackUrl: "https://portal.example.com/api/auth/sso/oidc/callback?code=abc&state=" + start.state.state,
      expectedState: start.state.state,
    });

    expect(result.protocol).toBe("oidc");
    expect(result.identity.email).toBe("owner@agenticx.local");
    expect(result.identity.externalSubject).toBe("oidc-sub");
    expect(result.identity.roleCodeHints).toEqual(["member", "policy_admin"]);
    expect(result.identity.rawAttributes).toMatchObject({ sub: "oidc-sub", email: "owner@agenticx.local" });
  });

  it("handleCallback rejects mismatched providerId in cookie", async () => {
    mockDiscovery.mockResolvedValue({ issuer: provider.issuer });
    mockChallenge.mockResolvedValue("c");
    mockRandomVerifier.mockReturnValue("v");
    mockBuildAuthorizationUrl.mockReturnValue(new URL("https://idp.example.com/auth"));

    const handler = new OidcProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({ provider, cookieSecret });

    await expect(
      handler.handleCallback({
        provider: { ...provider, providerId: "different" },
        cookieSecret,
        cookieValue: start.cookie?.value,
        callbackUrl: "https://portal.example.com/api/auth/sso/oidc/callback?code=abc",
        expectedState: start.state.state,
      })
    ).rejects.toMatchObject({ code: "oidc.invalid_state_payload" });
  });

  it("startAuthentication throws oidc.state_secret_missing without cookie secret", async () => {
    const handler = new OidcProtocolHandler();
    await expect(
      handler.startAuthentication({ provider, cookieSecret: "" })
    ).rejects.toMatchObject({ code: "oidc.state_secret_missing" });
  });
});

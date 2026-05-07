import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const buildStateCookieValueMock = vi.fn();
const getPortalSsoProviderConfigServerMock = vi.fn();
const getPortalSsoProviderOptionsMock = vi.fn();
const buildAuthorizationUrlMock = vi.fn();
const createCodeVerifierMock = vi.fn();

vi.mock("@agenticx/auth", () => ({
  OidcConfigError: class OidcConfigError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  buildStateCookieValue: (...args: unknown[]) => buildStateCookieValueMock(...args),
}));

vi.mock("../../../../../../lib/sso-runtime", () => ({
  getPortalSsoProviderConfigServer: (...args: unknown[]) => getPortalSsoProviderConfigServerMock(...args),
  getPortalSsoProviderOptions: (...args: unknown[]) => getPortalSsoProviderOptionsMock(...args),
  getOidcClientService: () => ({
    createCodeVerifier: (...args: unknown[]) => createCodeVerifierMock(...args),
    buildAuthorizationUrl: (...args: unknown[]) => buildAuthorizationUrlMock(...args),
  }),
  resolveReturnToOrDefault: (returnTo: string | null) => returnTo || "/workspace",
}));

import { GET } from "../start/route";

describe("Portal OIDC start provider fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SSO_STATE_SIGNING_SECRET = "x".repeat(32);
    buildStateCookieValueMock.mockReturnValue({
      cookieValue: "signed-state",
      state: { state: "state-1", nonce: "nonce-1", codeVerifier: "code-verifier-1" },
    });
    createCodeVerifierMock.mockReturnValue("generated-verifier");
    buildAuthorizationUrlMock.mockResolvedValue("https://idp.backup.example.com/authorize");
  });

  it("falls back to the next configured provider when requested provider is unavailable", async () => {
    getPortalSsoProviderOptionsMock.mockReturnValue([
      { id: "primary", name: "Primary" },
      { id: "backup", name: "Backup" },
      { id: "backup", name: "Backup Duplicate" },
    ]);
    getPortalSsoProviderConfigServerMock.mockImplementation(async (providerId: string) => {
      if (providerId === "primary") throw new Error("oidc.provider_disabled");
      return {
        providerId,
        issuer: "https://idp.backup.example.com",
        clientId: "cid",
        redirectUri: "https://portal.example.com/api/auth/sso/oidc/callback",
        scopes: ["openid", "profile", "email"],
        claimMapping: { email: "email", name: "name", dept: "department", roles: "roles", externalId: "sub" },
      };
    });

    const res = await GET(new Request("https://portal.example.com/api/auth/sso/oidc/start?provider=primary"));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("https://idp.backup.example.com/authorize");
    expect(getPortalSsoProviderConfigServerMock.mock.calls.map((call) => call[0])).toEqual([
      "primary",
      "backup",
    ]);
  });

  it("keeps original error when all candidates are unavailable", async () => {
    getPortalSsoProviderOptionsMock.mockReturnValue([{ id: "backup", name: "Backup" }]);
    getPortalSsoProviderConfigServerMock.mockImplementation(async (providerId: string) => {
      if (providerId === "primary") throw new Error("oidc.provider_disabled");
      throw new Error("oidc.provider_not_configured");
    });

    const res = await GET(new Request("https://portal.example.com/api/auth/sso/oidc/start?provider=primary"));

    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const redirected = new URL(location!, "https://portal.example.com");
    expect(redirected.pathname).toBe("/auth");
    expect(redirected.searchParams.get("sso_error")).toBe("oidc.provider_disabled");
    expect(getPortalSsoProviderConfigServerMock.mock.calls.map((call) => call[0])).toEqual([
      "primary",
      "backup",
    ]);
  });
});

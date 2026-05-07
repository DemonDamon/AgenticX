import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const buildStateCookieValueMock = vi.fn();
const getAdminSsoProviderConfigServerMock = vi.fn();
const getAdminSsoProviderOptionsMock = vi.fn();
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

vi.mock("../../../../../../lib/admin-sso-runtime", () => ({
  getAdminSsoProviderConfigServer: (...args: unknown[]) => getAdminSsoProviderConfigServerMock(...args),
  getAdminSsoProviderOptions: (...args: unknown[]) => getAdminSsoProviderOptionsMock(...args),
  getOidcClientService: () => ({
    createCodeVerifier: (...args: unknown[]) => createCodeVerifierMock(...args),
    buildAuthorizationUrl: (...args: unknown[]) => buildAuthorizationUrlMock(...args),
  }),
}));

import { GET } from "../start/route";

describe("Admin OIDC start provider fallback", () => {
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
    getAdminSsoProviderOptionsMock.mockReturnValue([
      { id: "primary", name: "Primary" },
      { id: "backup", name: "Backup" },
      { id: "backup", name: "Backup Duplicate" },
    ]);
    getAdminSsoProviderConfigServerMock.mockImplementation(async (providerId: string) => {
      if (providerId === "primary") throw new Error("oidc.provider_not_configured");
      return {
        providerId,
        issuer: "https://idp.backup.example.com",
        clientId: "cid",
        redirectUri: "https://admin.example.com/api/auth/sso/oidc/callback",
        scopes: ["openid", "profile", "email"],
        claimMapping: { email: "email", name: "name", dept: "department", roles: "roles", externalId: "sub" },
      };
    });

    const res = await GET(new Request("https://admin.example.com/api/auth/sso/oidc/start?provider=primary"));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("https://idp.backup.example.com/authorize");
    expect(getAdminSsoProviderConfigServerMock.mock.calls.map((call) => call[0])).toEqual([
      "primary",
      "backup",
    ]);
  });

  it("keeps original error when all candidates are unavailable", async () => {
    getAdminSsoProviderOptionsMock.mockReturnValue([{ id: "backup", name: "Backup" }]);
    getAdminSsoProviderConfigServerMock.mockImplementation(async (providerId: string) => {
      if (providerId === "primary") throw new Error("oidc.provider_disabled");
      throw new Error("oidc.provider_not_configured");
    });

    const res = await GET(new Request("https://admin.example.com/api/auth/sso/oidc/start?provider=primary"));

    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const redirected = new URL(location!, "https://admin.example.com");
    expect(redirected.pathname).toBe("/login");
    expect(redirected.searchParams.get("sso_error")).toBe("oidc.provider_disabled");
    expect(getAdminSsoProviderConfigServerMock.mock.calls.map((call) => call[0])).toEqual([
      "primary",
      "backup",
    ]);
  });
});

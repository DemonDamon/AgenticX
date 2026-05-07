import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSsoProviders } from "../admin-sso-provider-options";

vi.mock("server-only", () => ({}));
const getSsoProviderByProviderIdMock = vi.fn<(tenantId: string, providerId: string) => Promise<any>>();
vi.mock("@agenticx/iam-core", () => ({
  getSsoProviderByProviderId: getSsoProviderByProviderIdMock,
  insertAuditEvent: vi.fn(),
}));

const ENV_BACKUP = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BACKUP)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  vi.resetModules();
  restoreEnv();
  getSsoProviderByProviderIdMock.mockReset();
  getSsoProviderByProviderIdMock.mockResolvedValue(null);
});

afterEach(() => {
  restoreEnv();
});

describe("parseSsoProviders", () => {
  it("parses provider options", () => {
    expect(parseSsoProviders("default:Keycloak,entra:Azure Entra:saml")).toEqual([
      { id: "default", name: "Keycloak", protocol: "oidc" },
      { id: "entra", name: "Azure Entra", protocol: "saml" },
    ]);
  });
});

describe("getAdminSsoProviderConfigServer", () => {
  it("rejects example issuer placeholders before OIDC discovery", async () => {
    process.env.DEFAULT_TENANT_ID = "01J00000000000000000000001";
    process.env.SSO_OIDC_DEFAULT_ISSUER = "https://idp.example.com/realms/agenticx";
    process.env.SSO_OIDC_DEFAULT_CLIENT_ID = "agenticx-portal";
    process.env.SSO_OIDC_DEFAULT_ADMIN_REDIRECT_URI = "http://localhost:3001/api/auth/sso/oidc/callback";

    const { getAdminSsoProviderConfigServer } = await import("../admin-sso-runtime");

    await expect(getAdminSsoProviderConfigServer("default")).rejects.toThrow("oidc.provider_not_configured");
  });

  it("rejects db provider using example issuer placeholder", async () => {
    process.env.DEFAULT_TENANT_ID = "01J00000000000000000000001";
    getSsoProviderByProviderIdMock.mockResolvedValueOnce({
      providerId: "default",
      protocol: "oidc",
      enabled: true,
      issuer: "https://idp.example.com/realms/agenticx",
      clientId: "agenticx-admin",
      redirectUri: "http://localhost:3001/api/auth/sso/oidc/callback",
      clientSecretEncrypted: null,
      scopes: ["openid", "profile", "email"],
      claimMapping: {},
    });

    const { getAdminSsoProviderConfigServer } = await import("../admin-sso-runtime");

    await expect(getAdminSsoProviderConfigServer("default")).rejects.toThrow("oidc.provider_not_configured");
  });
});

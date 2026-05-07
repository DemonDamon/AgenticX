import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSsoProviders } from "../admin-sso-provider-options";

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  getSsoProviderByProviderId: vi.fn(async () => null),
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
});

afterEach(() => {
  restoreEnv();
});

describe("parseSsoProviders", () => {
  it("parses provider options", () => {
    expect(parseSsoProviders("default:Keycloak,entra:Azure Entra")).toEqual([
      { id: "default", name: "Keycloak" },
      { id: "entra", name: "Azure Entra" },
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
});

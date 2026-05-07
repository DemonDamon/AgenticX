import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSsoProviders } from "../sso-provider-options";
import { resolveReturnToOrDefault } from "../sso-return-to";

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
  it("parses provider list from env-like string", () => {
    const providers = parseSsoProviders("default:Keycloak, azure:Azure AD");
    expect(providers).toEqual([
      { id: "default", name: "Keycloak" },
      { id: "azure", name: "Azure AD" },
    ]);
  });

  it("returns empty list for blank source", () => {
    expect(parseSsoProviders("")).toEqual([]);
    expect(parseSsoProviders(undefined)).toEqual([]);
  });
});

describe("resolveReturnToOrDefault", () => {
  it("falls back for unsafe or missing returnTo", () => {
    expect(resolveReturnToOrDefault(null)).toBe("/workspace");
    expect(resolveReturnToOrDefault("https://evil.example.com")).toBe("/workspace");
    expect(resolveReturnToOrDefault("//evil")).toBe("/workspace");
  });
});

describe("getPortalSsoProviderConfigServer", () => {
  it("rejects example issuer placeholders before OIDC discovery", async () => {
    process.env.DEFAULT_TENANT_ID = "01J00000000000000000000001";
    process.env.SSO_OIDC_DEFAULT_ISSUER = "https://idp.example.com/realms/agenticx";
    process.env.SSO_OIDC_DEFAULT_CLIENT_ID = "agenticx-portal";
    process.env.SSO_OIDC_DEFAULT_REDIRECT_URI = "http://localhost:3000/api/auth/sso/oidc/callback";

    const { getPortalSsoProviderConfigServer } = await import("../sso-runtime");

    await expect(getPortalSsoProviderConfigServer("default")).rejects.toThrow("oidc.provider_not_configured");
  });
});

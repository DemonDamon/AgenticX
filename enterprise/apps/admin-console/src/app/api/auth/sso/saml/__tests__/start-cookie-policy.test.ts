import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getAdminSamlProviderConfigServerMock = vi.fn();
const startAuthenticationMock = vi.fn();

vi.mock("@agenticx/auth", () => ({
  SamlCallbackError: class SamlCallbackError extends Error {},
  SamlConfigError: class SamlConfigError extends Error {},
  DEFAULT_SAML_ADMIN_STATE_COOKIE: "agenticx_saml_state_admin",
  createSamlProtocolHandler: () => ({
    startAuthentication: (...args: unknown[]) => startAuthenticationMock(...args),
  }),
}));

vi.mock("../../../../../../lib/admin-sso-runtime", () => ({
  getAdminSamlProviderConfigServer: (...args: unknown[]) =>
    getAdminSamlProviderConfigServerMock(...args),
}));

const ENV_BACKUP = { ...process.env };
function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BACKUP)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    process.env[k] = v;
  }
}

describe("admin saml start cookie policy", () => {
  beforeEach(() => {
    getAdminSamlProviderConfigServerMock.mockReset();
    startAuthenticationMock.mockReset();
    delete process.env.SSO_SAML_DISABLED;
    process.env.SSO_STATE_SIGNING_SECRET = "x".repeat(32);
    getAdminSamlProviderConfigServerMock.mockResolvedValue({
      providerId: "default",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "https://idp.example.com/sso",
      idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
      spEntityId: "https://admin.example.com/saml/metadata",
      acsUrl: "https://admin.example.com/api/auth/sso/saml/callback",
    });
    startAuthenticationMock.mockResolvedValue({
      kind: "redirect",
      redirectUrl: "https://idp.example.com/sso",
      cookie: {
        name: "agenticx_saml_state_admin",
        value: "state",
        maxAgeSeconds: 300,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    restoreEnv();
  });

  it("uses SameSite=None and Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { GET } = await import("../start/route");
    const response = await GET(
      new Request("https://admin.example.com/api/auth/sso/saml/start?provider=default")
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/samesite=none/i);
    expect(setCookie).toContain("Secure");
  });

  it("keeps SameSite=Lax in non-production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { GET } = await import("../start/route");
    const response = await GET(
      new Request("https://admin.example.com/api/auth/sso/saml/start?provider=default")
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/samesite=lax/i);
  });
});

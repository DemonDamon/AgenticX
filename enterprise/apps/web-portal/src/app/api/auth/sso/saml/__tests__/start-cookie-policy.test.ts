import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getPortalSamlProviderConfigServerMock = vi.fn();
const startAuthenticationMock = vi.fn();

vi.mock("@agenticx/auth", () => ({
  SamlCallbackError: class SamlCallbackError extends Error {},
  SamlConfigError: class SamlConfigError extends Error {},
  DEFAULT_SAML_PORTAL_STATE_COOKIE: "agenticx_saml_state_portal",
  createSamlProtocolHandler: () => ({
    startAuthentication: (...args: unknown[]) => startAuthenticationMock(...args),
  }),
}));

vi.mock("../../../../../../lib/sso-runtime", () => ({
  getPortalSamlProviderConfigServer: (...args: unknown[]) =>
    getPortalSamlProviderConfigServerMock(...args),
  resolveReturnToOrDefault: (raw: string | null) => raw ?? "/workspace",
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

describe("portal saml start cookie policy", () => {
  beforeEach(() => {
    getPortalSamlProviderConfigServerMock.mockReset();
    startAuthenticationMock.mockReset();
    delete process.env.SSO_SAML_DISABLED;
    process.env.SSO_STATE_SIGNING_SECRET = "x".repeat(32);
    getPortalSamlProviderConfigServerMock.mockResolvedValue({
      providerId: "default",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "https://idp.example.com/sso",
      idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
      spEntityId: "https://portal.example.com/saml/metadata",
      acsUrl: "https://portal.example.com/api/auth/sso/saml/callback",
    });
    startAuthenticationMock.mockResolvedValue({
      kind: "redirect",
      redirectUrl: "https://idp.example.com/sso",
      cookie: {
        name: "agenticx_saml_state_portal",
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
      new Request("https://portal.example.com/api/auth/sso/saml/start?provider=default")
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
      new Request("https://portal.example.com/api/auth/sso/saml/start?provider=default")
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/samesite=lax/i);
  });
});

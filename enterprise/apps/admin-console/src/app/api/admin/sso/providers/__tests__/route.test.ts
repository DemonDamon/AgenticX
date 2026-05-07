import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listSsoProvidersMock = vi.fn();
const createSsoProviderMock = vi.fn();
const assertSafeIssuerUrlMock = vi.fn();
const assertSafeRedirectUriMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  listSsoProviders: (...args: unknown[]) => listSsoProvidersMock(...args),
  createSsoProvider: (...args: unknown[]) => createSsoProviderMock(...args),
}));

vi.mock("../../../../../../lib/sso-url-guard", () => ({
  assertSafeIssuerUrl: (...args: unknown[]) => assertSafeIssuerUrlMock(...args),
  assertSafeRedirectUri: (...args: unknown[]) => assertSafeRedirectUriMock(...args),
}));

describe("admin sso providers route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listSsoProvidersMock.mockReset();
    createSsoProviderMock.mockReset();
    assertSafeIssuerUrlMock.mockReset();
    assertSafeRedirectUriMock.mockReset();
    delete process.env.SSO_SAML_DISABLED;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET returns samlGloballyDisabled from server env flag", async () => {
    process.env.SSO_SAML_DISABLED = "true";
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1" },
    });
    listSsoProvidersMock.mockResolvedValue([]);

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: { samlGloballyDisabled?: boolean; providers?: unknown[] };
    };
    expect(body.data?.providers).toEqual([]);
    expect(body.data?.samlGloballyDisabled).toBe(true);
  });

  it("POST rejects unsafe SAML URLs with 400", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "admin_1" },
    });
    assertSafeIssuerUrlMock.mockRejectedValueOnce(new Error("issuer_host_not_allowed"));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example.com/api/admin/sso/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "saml-default",
          displayName: "SAML",
          protocol: "saml",
          samlConfig: {
            idpEntityId: "https://idp.example.org/idp",
            idpSsoUrl: "http://localhost:9000/sso",
            idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
            spEntityId: "https://portal.example.com/saml/metadata",
            acsUrl: "https://portal.example.com/api/auth/sso/saml/callback",
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("SSO 配置不合法");
    expect(createSsoProviderMock).not.toHaveBeenCalled();
  });

  it("POST allows localhost mock IdP URLs in non-production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "admin_1" },
    });
    createSsoProviderMock.mockResolvedValue({
      id: "p_local",
      protocol: "saml",
      providerId: "saml-local",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example.com/api/admin/sso/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "saml-local",
          displayName: "SAML Local",
          protocol: "saml",
          samlConfig: {
            idpEntityId: "http://127.0.0.1:9000/idp",
            idpSsoUrl: "http://localhost:9000/sso",
            idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
            spEntityId: "https://portal.example.com/saml/metadata",
            acsUrl: "https://portal.example.com/api/auth/sso/saml/callback",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(assertSafeIssuerUrlMock).not.toHaveBeenCalled();
    expect(createSsoProviderMock).toHaveBeenCalledTimes(1);
  });
});

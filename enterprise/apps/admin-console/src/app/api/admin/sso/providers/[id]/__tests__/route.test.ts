import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const getSsoProviderByIdMock = vi.fn();
const updateSsoProviderMock = vi.fn();
const assertSafeIssuerUrlMock = vi.fn();
const assertSafeRedirectUriMock = vi.fn();
const invalidateIssuerDnsCacheForHostMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  getSsoProviderById: (...args: unknown[]) => getSsoProviderByIdMock(...args),
  updateSsoProvider: (...args: unknown[]) => updateSsoProviderMock(...args),
  deleteSsoProvider: vi.fn(),
}));

vi.mock("../../../../../../../lib/admin-sso-runtime", () => ({
  getOidcClientService: () => ({
    invalidateProvider: vi.fn(),
  }),
}));

vi.mock("../../../../../../../lib/sso-url-guard", () => ({
  assertSafeIssuerUrl: (...args: unknown[]) => assertSafeIssuerUrlMock(...args),
  assertSafeRedirectUri: (...args: unknown[]) => assertSafeRedirectUriMock(...args),
  invalidateIssuerDnsCacheForHost: (...args: unknown[]) => invalidateIssuerDnsCacheForHostMock(...args),
}));

describe("admin sso provider patch route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    getSsoProviderByIdMock.mockReset();
    updateSsoProviderMock.mockReset();
    assertSafeIssuerUrlMock.mockReset();
    assertSafeRedirectUriMock.mockReset();
    invalidateIssuerDnsCacheForHostMock.mockReset();
    delete process.env.SSO_SAML_DISABLED;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects enabling SAML provider when rollback switch is enabled", async () => {
    process.env.SSO_SAML_DISABLED = "true";
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "admin_1" },
    });
    getSsoProviderByIdMock.mockResolvedValue({
      id: "p1",
      protocol: "saml",
      providerId: "saml-default",
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      new Request("https://admin.example.com/api/admin/sso/providers/p1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("SAML");
    expect(updateSsoProviderMock).not.toHaveBeenCalled();
  });

  it.each(["issuer", "clientId", "redirectUri"] as const)(
    "rejects empty %s when target protocol is oidc",
    async (field) => {
      requireAdminScopeMock.mockResolvedValue({
        ok: true,
        session: { tenantId: "tenant_1", userId: "admin_1" },
      });
      getSsoProviderByIdMock.mockResolvedValue({
        id: "p1",
        protocol: "oidc",
        providerId: "oidc-default",
      });

      const { PATCH } = await import("../route");
      const response = await PATCH(
        new Request("https://admin.example.com/api/admin/sso/providers/p1", {
          method: "PATCH",
          body: JSON.stringify({ [field]: "   " }),
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: "p1" }) }
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { message?: string };
      expect(body.message).toContain(field);
      expect(updateSsoProviderMock).not.toHaveBeenCalled();
    }
  );

  it("rejects protocol override attempts from request body", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "admin_1" },
    });
    getSsoProviderByIdMock.mockResolvedValue({
      id: "p1",
      protocol: "oidc",
      providerId: "oidc-default",
    });
    updateSsoProviderMock.mockResolvedValue({
      id: "p1",
      protocol: "oidc",
      providerId: "oidc-default",
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      new Request("https://admin.example.com/api/admin/sso/providers/p1", {
        method: "PATCH",
        body: JSON.stringify({ protocol: "saml" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("protocol");
    expect(updateSsoProviderMock).not.toHaveBeenCalled();
  });

  it("rejects PATCH when samlConfig contains unsafe idpSsoUrl", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "admin_1" },
    });
    assertSafeIssuerUrlMock.mockRejectedValueOnce(new Error("issuer_host_not_allowed"));
    getSsoProviderByIdMock.mockResolvedValue({
      id: "p1",
      protocol: "saml",
      providerId: "saml-default",
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      new Request("https://admin.example.com/api/admin/sso/providers/p1", {
        method: "PATCH",
        body: JSON.stringify({
          samlConfig: {
            idpEntityId: "https://idp.example.org/idp",
            idpSsoUrl: "http://localhost:9000/sso",
            idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
            spEntityId: "https://portal.example.com/saml/metadata",
            acsUrl: "https://portal.example.com/api/auth/sso/saml/callback",
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("SSO 配置不合法");
    expect(updateSsoProviderMock).not.toHaveBeenCalled();
  });

  it("allows localhost mock IdP URLs in non-production PATCH", async () => {
    vi.stubEnv("NODE_ENV", "development");
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "admin_1" },
    });
    getSsoProviderByIdMock.mockResolvedValue({
      id: "p1",
      protocol: "saml",
      providerId: "saml-default",
    });
    updateSsoProviderMock.mockResolvedValue({
      id: "p1",
      protocol: "saml",
      providerId: "saml-default",
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      new Request("https://admin.example.com/api/admin/sso/providers/p1", {
        method: "PATCH",
        body: JSON.stringify({
          samlConfig: {
            idpEntityId: "http://127.0.0.1:9000/idp",
            idpSsoUrl: "http://localhost:9000/sso",
            idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
            spEntityId: "https://portal.example.com/saml/metadata",
            acsUrl: "https://portal.example.com/api/auth/sso/saml/callback",
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(response.status).toBe(200);
    expect(assertSafeIssuerUrlMock).not.toHaveBeenCalled();
    expect(updateSsoProviderMock).toHaveBeenCalledTimes(1);
  });
});

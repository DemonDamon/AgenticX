import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const getSsoProviderByIdMock = vi.fn();
const assertSafeIssuerUrlMock = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  getSsoProviderById: (...args: unknown[]) => getSsoProviderByIdMock(...args),
}));

vi.mock("../../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../../../../lib/sso-url-guard", () => ({
  assertSafeIssuerUrl: (...args: unknown[]) => assertSafeIssuerUrlMock(...args),
}));

describe("sso provider health route", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    getSsoProviderByIdMock.mockReset();
    assertSafeIssuerUrlMock.mockReset();
    delete process.env.SSO_SAML_DISABLED;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("guards saml idpSsoUrl before outbound HEAD", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1" },
    });
    getSsoProviderByIdMock.mockResolvedValue({
      protocol: "saml",
      samlConfig: {
        idpSsoUrl: "https://idp.example.com/sso",
        idpCertPemList: [],
      },
    });
    assertSafeIssuerUrlMock.mockRejectedValue(new Error("issuer_host_not_allowed"));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example.com/api/admin/sso/providers/p1/health", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(assertSafeIssuerUrlMock).toHaveBeenCalledWith("https://idp.example.com/sso");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: { health?: { ssoUrlReachable?: boolean | null; ssoUrlError?: string } };
    };
    expect(body.data?.health?.ssoUrlReachable).toBe(false);
    expect(body.data?.health?.ssoUrlError).toBe("issuer_host_not_allowed");
  });

  it("rejects SAML health check when rollback switch is enabled", async () => {
    process.env.SSO_SAML_DISABLED = "true";
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1" },
    });
    getSsoProviderByIdMock.mockResolvedValue({
      protocol: "saml",
      samlConfig: {
        idpSsoUrl: "https://idp.example.com/sso",
        idpCertPemList: [],
      },
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example.com/api/admin/sso/providers/p1/health", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("SAML");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

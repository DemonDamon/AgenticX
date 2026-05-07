import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertAuditEventMock = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  insertAuditEvent: (...args: unknown[]) => insertAuditEventMock(...args),
  sanitizeSsoAuditDetail: (detail: Record<string, unknown>) => ({ ...detail }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("../../../../../../lib/sso-runtime", () => ({
  getPortalSamlProviderConfigServer: vi.fn(async () => {
    throw new Error("must not be called");
  }),
  resolveReturnToOrDefault: (raw: string | null) => raw ?? "/workspace",
}));

vi.mock("../../../../../../lib/auth-runtime", () => ({
  loginWithOidcClaims: vi.fn(),
}));

vi.mock("../../../../../../lib/session", () => ({
  ACCESS_COOKIE: "agx_access",
  REFRESH_COOKIE: "agx_refresh",
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

beforeEach(() => {
  insertAuditEventMock.mockReset();
  process.env.DEFAULT_TENANT_ID = "test_tenant";
  process.env.DATABASE_URL = "postgres://test/test";
  process.env.SSO_STATE_SIGNING_SECRET = "x".repeat(32);
  process.env.SSO_SAML_DISABLED = "true";
});

afterEach(() => {
  restoreEnv();
});

describe("portal SAML routes honour SSO_SAML_DISABLED", () => {
  it("start route redirects to /auth?sso_error=saml.provider_not_configured", async () => {
    const { GET } = await import("../start/route");
    const response = await GET(
      new Request("https://portal.example.com/api/auth/sso/saml/start?provider=default")
    );
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location");
    expect(location).toContain("sso_error=saml.provider_not_configured");
  });

  it("callback route returns 400 saml.provider_not_configured and writes failure audit", async () => {
    const { POST } = await import("../callback/route");
    const formData = new URLSearchParams();
    formData.set("SAMLResponse", "fake");
    formData.set("RelayState", "rs");
    const response = await POST(
      new Request("https://portal.example.com/api/auth/sso/saml/callback", {
        method: "POST",
        body: formData,
      })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("saml.provider_not_configured");
    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    const call = insertAuditEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.eventType).toBe("auth.sso.login_failed");
    const detail = call.detail as Record<string, unknown>;
    expect(detail.protocol).toBe("saml");
    expect(detail.reason_code).toBe("saml.provider_not_configured");
  });
});

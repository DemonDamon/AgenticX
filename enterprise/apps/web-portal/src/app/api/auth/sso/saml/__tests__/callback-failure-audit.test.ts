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
  getPortalSamlProviderConfigServer: vi.fn(),
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

function restoreEnv(): void {
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
  vi.stubEnv("NODE_ENV", "production");
  delete process.env.SSO_SAML_DISABLED;
});

afterEach(() => {
  vi.unstubAllEnvs();
  restoreEnv();
});

describe("portal saml callback parse failure", () => {
  it("audits auth.sso.login_failed and redirects with sso_error", async () => {
    const { POST } = await import("../callback/route");
    const request = {
      url: "https://portal.example.com/api/auth/sso/saml/callback",
      formData: vi.fn(async () => {
        throw new Error("bad-form");
      }),
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/auth?sso_error=saml.callback_failed");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/samesite=none/i);
    expect(setCookie).toContain("Secure");
    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    const call = insertAuditEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.eventType).toBe("auth.sso.login_failed");
    expect((call.detail as Record<string, unknown>).reason_code).toBe("saml.callback_failed");
  });
});

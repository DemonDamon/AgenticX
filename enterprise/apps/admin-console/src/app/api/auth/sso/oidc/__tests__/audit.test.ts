import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Admin SSO callback audit integration tests (AC-B1.1).
 * Mocks @agenticx/iam-core::insertAuditEvent so we can assert the reason_code
 * captured for admin_scope_missing failures without touching Postgres.
 */

const insertAuditEventMock = vi.fn();
const authenticateAdminMock = vi.fn();
const exchangeCallbackMock = vi.fn();
const getAdminSsoProviderConfigServerMock = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  insertAuditEvent: (...args: unknown[]) => insertAuditEventMock(...args),
  sanitizeSsoAuditDetail: (detail: Record<string, unknown>) => ({ ...detail }),
}));

vi.mock("@agenticx/auth", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    validateStateFromCookie: vi.fn(() => ({
      providerId: "default",
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
      returnTo: "/dashboard",
    })),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => ({ value: "stub-cookie" }),
  }),
}));

vi.mock("../../../../../../lib/admin-pg-auth", () => ({
  authenticateAdminConsoleViaOidc: (...args: unknown[]) => authenticateAdminMock(...args),
}));

vi.mock("../../../../../../lib/admin-session", () => ({
  ADMIN_SESSION_COOKIE: "agx_admin_session",
  createAdminSessionToken: () => "stub-admin-token",
}));

vi.mock("../../../../../../lib/admin-sso-runtime", () => ({
  getAdminSsoProviderConfigServer: (...args: unknown[]) =>
    getAdminSsoProviderConfigServerMock(...args),
  getOidcClientService: () => ({
    exchangeCallback: (...args: unknown[]) => exchangeCallbackMock(...args),
  }),
}));

const ENV_BACKUP = { ...process.env };

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

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
  authenticateAdminMock.mockReset();
  exchangeCallbackMock.mockReset();
  getAdminSsoProviderConfigServerMock.mockReset();
  process.env.DEFAULT_TENANT_ID = "test_tenant";
  process.env.DATABASE_URL = "postgres://test/test";
  process.env.SSO_STATE_SIGNING_SECRET = "x".repeat(32);
  setNodeEnv("test");
});

afterEach(() => {
  restoreEnv();
});

describe("admin-console SSO callback audit (FR-B1.2)", () => {
  it("records auth.sso.login_failed with reason_code=admin_scope_missing", async () => {
    getAdminSsoProviderConfigServerMock.mockResolvedValue({
      providerId: "default",
      issuer: "https://idp.example.com",
      clientId: "agenticx-admin",
      redirectUri: "https://admin.example.com/api/auth/sso/oidc/callback",
      scopes: ["openid", "profile", "email"],
      claimMapping: {},
    });
    exchangeCallbackMock.mockResolvedValue({
      claims: { sub: "u1", email: "no-admin@example.com" },
      mapped: {
        email: "no-admin@example.com",
        displayName: "Member User",
        externalId: "u1",
        deptHint: null,
        roleCodeHints: [],
      },
      rawTokens: {},
    });
    authenticateAdminMock.mockResolvedValue({ ok: false, reason: "admin_scope_missing" });

    const { GET } = await import("../callback/route");
    const request = new Request(
      "https://admin.example.com/api/auth/sso/oidc/callback?state=state-1"
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("sso_error=admin_scope_missing");

    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    const call = insertAuditEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.eventType).toBe("auth.sso.login_failed");
    expect(call.targetKind).toBe("sso_login");
    const detail = call.detail as Record<string, unknown>;
    expect(detail.reason_code).toBe("admin_scope_missing");
    expect(detail.email_hint).toBe("no-admin@example.com");
    expect(detail.provider_id).toBe("default");
  });
});

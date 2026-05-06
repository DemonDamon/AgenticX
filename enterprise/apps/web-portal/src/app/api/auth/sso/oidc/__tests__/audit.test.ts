import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Audit integration tests for SSO callback failures (AC-B1.1).
 * Mocks @agenticx/iam-core::insertAuditEvent so we can assert the structured
 * reason_code captured per failure path without touching Postgres.
 */

const insertAuditEventMock = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  insertAuditEvent: (...args: unknown[]) => insertAuditEventMock(...args),
  sanitizeSsoAuditDetail: (detail: Record<string, unknown>) => ({ ...detail }),
}));

vi.mock("@agenticx/auth", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    validateStateFromCookie: vi.fn(() => {
      throw new Error("oidc.invalid_state");
    }),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => ({ value: "stub-cookie" }),
  }),
}));

vi.mock("../../../../../../lib/sso-runtime", () => ({
  getOidcClientService: () => ({
    exchangeCallback: vi.fn(),
  }),
  getPortalSsoProviderConfigServer: vi.fn(),
  resolveReturnToOrDefault: (raw: string) => raw,
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
});

afterEach(() => {
  restoreEnv();
});

describe("portal SSO callback audit (FR-B1.2)", () => {
  it("records auth.sso.login_failed with reason_code=oidc.invalid_state on state mismatch", async () => {
    const { GET } = await import("../callback/route");
    const request = new Request(
      "https://portal.example.com/api/auth/sso/oidc/callback?state=tampered"
    );
    const response = await GET(request);

    // Should redirect to /auth?sso_error=oidc.invalid_state.
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("sso_error=oidc.invalid_state");

    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    const call = insertAuditEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.eventType).toBe("auth.sso.login_failed");
    expect(call.targetKind).toBe("sso_login");
    const detail = call.detail as Record<string, unknown>;
    expect(detail.reason_code).toBe("oidc.invalid_state");
  });
});

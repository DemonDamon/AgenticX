import { buildStateCookieValue } from "@agenticx/auth";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockGetSso = vi.fn();
const mockInsertAudit = vi.fn();

// `server-only` throws when imported from a non-Server-Component context (vitest).
// Mock it so the Next route module can be evaluated under the test runtime.
vi.mock("server-only", () => ({}));

vi.mock("@agenticx/iam-core", () => ({
  getSsoProviderByProviderId: (...args: unknown[]) => mockGetSso(...args),
  insertAuditEvent: (...args: unknown[]) => mockInsertAudit(...args),
  sanitizeSsoAuditDetail: (detail: Record<string, unknown>) => ({ ...detail }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { GET } from "../callback/route";
import { cookies } from "next/headers";

describe("OIDC callback provider_disabled (FR-C2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEFAULT_TENANT_ID = "tenant-1";
    process.env.SSO_STATE_SIGNING_SECRET = randomBytes(32).toString("hex");
    process.env.SSO_PROVIDER_SECRET_KEY = randomBytes(32).toString("hex");
    process.env.DATABASE_URL = "";
  });

  it("redirects to /auth with oidc.provider_disabled (AC-C2.1)", async () => {
    const secret = process.env.SSO_STATE_SIGNING_SECRET!;
    const { cookieValue, state } = buildStateCookieValue(
      { providerId: "default", returnTo: "/workspace", ttlMs: 10_000 },
      secret
    );

    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === "agenticx_oidc_state_portal" ? { name, value: cookieValue } : undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    mockGetSso.mockResolvedValue({
      id: "p1",
      tenantId: "tenant-1",
      providerId: "default",
      displayName: "Test",
      issuer: "https://idp.example.com",
      clientId: "cid",
      clientSecretEncrypted: null,
      redirectUri: "http://localhost:3000/api/auth/sso/oidc/callback",
      scopes: ["openid"],
      claimMapping: {},
      defaultRoleCodes: [],
      enabled: false,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const req = new Request(
      `http://localhost:3000/api/auth/sso/oidc/callback?state=${encodeURIComponent(state.state)}&code=x`
    );
    const res = await GET(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const u = new URL(loc!, "http://localhost:3000");
    expect(u.pathname).toBe("/auth");
    expect(u.searchParams.get("sso_error")).toBe("oidc.provider_disabled");
  });
});

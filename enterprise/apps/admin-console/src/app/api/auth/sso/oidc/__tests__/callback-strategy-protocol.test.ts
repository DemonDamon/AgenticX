import { buildStateCookieValue } from "@agenticx/auth";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@agenticx/iam-core", () => ({
  getSsoProviderByProviderId: vi.fn(async () => null),
  insertAuditEvent: vi.fn(),
  sanitizeSsoAuditDetail: (detail: Record<string, unknown>) => ({ ...detail }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { cookies } from "next/headers";

const ENV_BACKUP = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BACKUP)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    process.env[key] = value;
  }
}

describe("Admin OIDC callback AuthStrategyRegistry protocol gate (H4)", () => {
  beforeEach(() => {
    vi.resetModules();
    restoreEnv();
    process.env.DEFAULT_TENANT_ID = "tenant-1";
    process.env.SSO_STATE_SIGNING_SECRET = randomBytes(32).toString("hex");
    process.env.DATABASE_URL = "";
    delete process.env.SSO_OIDC_DEFAULT_STRATEGY;
  });

  afterEach(() => {
    restoreEnv();
  });

  async function callWithProvider(providerId: string) {
    const secret = process.env.SSO_STATE_SIGNING_SECRET!;
    const { cookieValue, state } = buildStateCookieValue(
      { providerId, returnTo: "/dashboard", ttlMs: 10_000 },
      secret,
    );
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === "agenticx_oidc_state_admin" ? { name, value: cookieValue } : undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const { GET } = await import("../callback/route");
    const req = new Request(
      `http://localhost:3001/api/auth/sso/oidc/callback?state=${encodeURIComponent(state.state)}&code=x`,
    );
    return GET(req);
  }

  it("rejects when STRATEGY forces saml protocol", async () => {
    process.env.SSO_OIDC_DEFAULT_STRATEGY = "saml";
    const res = await callWithProvider("default");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = new URL(res.headers.get("location")!, "http://localhost:3001");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("sso_error")).toBe("oidc.provider_not_configured");
  });

  it("rejects unknown strategy id via registry", async () => {
    process.env.SSO_OIDC_DEFAULT_STRATEGY = "nope-strategy";
    const res = await callWithProvider("default");
    const loc = new URL(res.headers.get("location")!, "http://localhost:3001");
    expect(loc.searchParams.get("sso_error")).toBe("oidc.provider_not_configured");
  });

  it("rejects fake-customer-iam (custom) on oidc callback", async () => {
    process.env.SSO_OIDC_DEFAULT_STRATEGY = "fake-customer-iam";
    const res = await callWithProvider("default");
    const loc = new URL(res.headers.get("location")!, "http://localhost:3001");
    expect(loc.searchParams.get("sso_error")).toBe("oidc.provider_not_configured");
  });
});

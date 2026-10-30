import {
  DEFAULT_SAML_PORTAL_STATE_COOKIE,
  encodeSignedSamlState,
} from "@agenticx/auth";
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

describe("Portal SAML callback AuthStrategyRegistry protocol gate (H4)", () => {
  beforeEach(() => {
    vi.resetModules();
    restoreEnv();
    process.env.DEFAULT_TENANT_ID = "tenant-1";
    process.env.SSO_STATE_SIGNING_SECRET = randomBytes(32).toString("hex");
    process.env.DATABASE_URL = "";
    delete process.env.SSO_SAML_DISABLED;
    delete process.env.SSO_OIDC_DEFAULT_STRATEGY;
  });

  afterEach(() => {
    restoreEnv();
  });

  async function callWithProvider(providerId: string) {
    const secret = process.env.SSO_STATE_SIGNING_SECRET!;
    const cookieValue = encodeSignedSamlState(
      {
        providerId,
        relayState: "relay",
        returnTo: "/workspace",
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === DEFAULT_SAML_PORTAL_STATE_COOKIE ? { name, value: cookieValue } : undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const form = new FormData();
    form.set("SAMLResponse", "fake-response");
    form.set("RelayState", "relay");
    const { POST } = await import("../callback/route");
    return POST(
      new Request("http://localhost:3000/api/auth/sso/saml/callback", {
        method: "POST",
        body: form,
      }),
    );
  }

  it("rejects when STRATEGY forces oidc protocol", async () => {
    process.env.SSO_OIDC_DEFAULT_STRATEGY = "oidc";
    const res = await callWithProvider("default");
    const loc = new URL(res.headers.get("location")!, "http://localhost:3000");
    expect(loc.pathname).toBe("/auth");
    expect(loc.searchParams.get("sso_error")).toBe("saml.provider_not_configured");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();

vi.mock("node:dns/promises", () => ({
  lookup: (hostname: string, options: unknown) => lookupMock(hostname, options),
}));

const ENV_BACKUP = { ...process.env };

async function freshGuard() {
  vi.resetModules();
  return import("../sso-url-guard");
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BACKUP)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    process.env[key] = value;
  }
}

/** `process.env.NODE_ENV` is typed read-only in strict Node types — tests need to toggle it. */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  lookupMock.mockReset();
  restoreEnv();
});

afterEach(() => {
  restoreEnv();
});

describe("assertSafeRedirectUri (FR-A1)", () => {
  it("rejects HTTP redirect outside dev allowlist in production (AC-A1.1: http)", async () => {
    setNodeEnv("production");
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("http://idp.example.com/cb")
    ).rejects.toThrow("redirect_uri_https_required");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects redirect_uri pointing to private IP (AC-A1.1: private)", async () => {
    setNodeEnv("production");
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("https://10.0.0.1/cb")
    ).rejects.toThrow("redirect_uri_host_not_allowed");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects redirect_uri whose hostname resolves to loopback IPv4 (AC-A1.1: dns-private)", async () => {
    setNodeEnv("production");
    lookupMock.mockResolvedValueOnce([{ family: 4, address: "127.0.0.1" }]);
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("https://internal.example.com/cb")
    ).rejects.toThrow("redirect_uri_host_not_allowed");
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect_uri whose origin is not in NEXT_PUBLIC_SSO_REDIRECT_ORIGIN_ALLOWLIST (AC-A1.1: cross-origin)", async () => {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_SSO_REDIRECT_ORIGIN_ALLOWLIST = "https://portal.example.com";
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("https://other.example.com/cb")
    ).rejects.toThrow("redirect_uri_origin_not_in_allowlist");
  });

  it("accepts redirect_uri whose origin matches the allowlist (positive case)", async () => {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_SSO_REDIRECT_ORIGIN_ALLOWLIST = "https://portal.example.com";
    lookupMock.mockResolvedValue([{ family: 4, address: "203.0.113.10" }]);
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("https://portal.example.com/api/auth/sso/oidc/callback")
    ).resolves.not.toThrow();
  });

  it("rejects redirect_uri whose origin does not match issuer when SSO_REDIRECT_REQUIRE_ISSUER_ORIGIN_MATCH=true", async () => {
    setNodeEnv("production");
    process.env.SSO_REDIRECT_REQUIRE_ISSUER_ORIGIN_MATCH = "true";
    lookupMock.mockResolvedValue([{ family: 4, address: "203.0.113.10" }]);
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("https://portal.example.com/cb", {
        issuerUrl: "https://idp.other.com/realms/ax",
      })
    ).rejects.toThrow("redirect_uri_issuer_origin_mismatch");
  });

  it("allows http://localhost in development without allowlist (dev convenience)", async () => {
    setNodeEnv("development");
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("http://localhost:3000/api/auth/sso/oidc/callback")
    ).resolves.not.toThrow();
  });

  it("allows http://127.0.0.1 in development without allowlist", async () => {
    setNodeEnv("development");
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("http://127.0.0.1:3000/api/auth/sso/oidc/callback")
    ).resolves.not.toThrow();
  });

  it("allows http://[::1] in development without allowlist", async () => {
    setNodeEnv("development");
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(
      assertSafeRedirectUri("http://[::1]:3000/api/auth/sso/oidc/callback")
    ).resolves.not.toThrow();
  });
});

describe("assertSafeIssuerUrl + DNS timeout/cache (FR-A2)", () => {
  it("rejects issuer DNS lookup that hangs longer than 5s (AC-A2.1: timeout)", async () => {
    setNodeEnv("production");
    vi.useFakeTimers();
    lookupMock.mockImplementation(
      () => new Promise(() => {
        // never resolves — verifies that lookupWithTimeout(5s) wins.
      })
    );
    const { assertSafeIssuerUrl } = await freshGuard();
    // Attach .catch synchronously so the timeout rejection is never "unhandled".
    const settled = assertSafeIssuerUrl("https://idp.example.com").catch((err) => err);
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("issuer_dns_timeout");
    vi.useRealTimers();
  });

  it("uses LRU cache: identical issuer host triggers DNS lookup once (AC-A2.1: cache)", async () => {
    setNodeEnv("production");
    lookupMock.mockResolvedValue([{ family: 4, address: "203.0.113.42" }]);
    const { assertSafeIssuerUrl } = await freshGuard();
    await assertSafeIssuerUrl("https://idp.example.com/realms/agenticx");
    await assertSafeIssuerUrl("https://idp.example.com/realms/agenticx");
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateIssuerDnsCacheForHost forces re-lookup (FR-A2.3)", async () => {
    setNodeEnv("production");
    lookupMock.mockResolvedValue([{ family: 4, address: "203.0.113.42" }]);
    const { assertSafeIssuerUrl, invalidateIssuerDnsCacheForHost } = await freshGuard();
    await assertSafeIssuerUrl("https://idp.example.com");
    invalidateIssuerDnsCacheForHost("idp.example.com");
    await assertSafeIssuerUrl("https://idp.example.com");
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("rejects issuer pointing to private IPv4 directly (no DNS)", async () => {
    setNodeEnv("production");
    const { assertSafeIssuerUrl } = await freshGuard();
    await expect(assertSafeIssuerUrl("https://10.0.0.5")).rejects.toThrow("issuer_host_not_allowed");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects issuer pointing to IPv4-mapped loopback IPv6 directly", async () => {
    setNodeEnv("production");
    const { assertSafeIssuerUrl } = await freshGuard();
    await expect(assertSafeIssuerUrl("https://[::ffff:127.0.0.1]")).rejects.toThrow("issuer_host_not_allowed");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects redirect_uri pointing to IPv4-mapped private IPv6 directly", async () => {
    setNodeEnv("production");
    const { assertSafeRedirectUri } = await freshGuard();
    await expect(assertSafeRedirectUri("https://[::ffff:10.0.0.1]/cb")).rejects.toThrow(
      "redirect_uri_host_not_allowed"
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

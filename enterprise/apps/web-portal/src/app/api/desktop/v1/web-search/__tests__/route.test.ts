import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const loadTenantWebSearchConfigStrict = vi.fn();
const resolveWebSearchConfig = vi.fn();
const executeWebSearch = vi.fn();
const reserveTenantDailySearchProviderCall = vi.fn();
const isTenantDailySearchProviderQuotaExceeded = vi.fn();

vi.mock("../../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfigStrict: (...args: unknown[]) =>
    loadTenantWebSearchConfigStrict(...args),
}));

vi.mock("../../../../../../lib/web-search/config", () => ({
  resolveWebSearchConfig: (...args: unknown[]) => resolveWebSearchConfig(...args),
}));

vi.mock("../../../../../../lib/web-search/providers", () => ({
  executeWebSearch: (...args: unknown[]) => executeWebSearch(...args),
}));

vi.mock("../../../../../../lib/web-search/daily-provider-quota", () => ({
  reserveTenantDailySearchProviderCall: (...args: unknown[]) =>
    reserveTenantDailySearchProviderCall(...args),
  isTenantDailySearchProviderQuotaExceeded: (...args: unknown[]) =>
    isTenantDailySearchProviderQuotaExceeded(...args),
}));

const identity = {
  userId: "user-1",
  tenantId: "tenant-1",
  deptId: "dept-1",
  email: "user@example.invalid",
  displayName: "User",
  tokenId: 1,
  scopes: ["workspace:chat", "desktop:managed"],
};

function request(body: unknown) {
  return new Request("https://portal.example.invalid/api/desktop/v1/web-search", {
    method: "POST",
    headers: {
      authorization: "Bearer agx-pat-test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/v1/web-search", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    loadTenantWebSearchConfigStrict.mockReset();
    resolveWebSearchConfig.mockReset();
    executeWebSearch.mockReset();
    reserveTenantDailySearchProviderCall.mockReset();
    isTenantDailySearchProviderQuotaExceeded.mockReset();

    resolveDesktopIdentity.mockResolvedValue(identity);
    loadTenantWebSearchConfigStrict.mockResolvedValue({ enabled: true });
    resolveWebSearchConfig.mockReturnValue({
      enabled: true,
      provider: "bocha",
      apiKey: "server-only-primary",
      maxResults: 5,
      primaryProviderId: "primary",
      providers: [
        { id: "primary", adapter: "bocha", apiKey: "server-only-primary", enabled: true, priority: 0 },
        { id: "fallback", adapter: "tavily", apiKey: "server-only-fallback", enabled: true, priority: 1 },
      ],
    });
    executeWebSearch.mockResolvedValue([
      { title: "Result", url: "https://example.invalid/result", snippet: "Summary" },
    ]);
    reserveTenantDailySearchProviderCall.mockResolvedValue(undefined);
    isTenantDailySearchProviderQuotaExceeded.mockReturnValue(false);
  });

  it("rejects an unauthenticated Desktop request", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../route");
    const response = await POST(request({ query: "latest news" }));
    expect(response.status).toBe(401);
    expect(executeWebSearch).not.toHaveBeenCalled();
  });

  it("requires the managed chat scope", async () => {
    resolveDesktopIdentity.mockResolvedValue({ ...identity, scopes: ["desktop:managed"] });
    const { POST } = await import("../route");
    const response = await POST(request({ query: "latest news" }));
    expect(response.status).toBe(403);
    expect(executeWebSearch).not.toHaveBeenCalled();
  });

  it("rejects an empty query before loading tenant secrets", async () => {
    const { POST } = await import("../route");
    const response = await POST(request({ query: "  " }));
    expect(response.status).toBe(400);
    expect(loadTenantWebSearchConfigStrict).not.toHaveBeenCalled();
  });

  it("honors the tenant-level disabled policy", async () => {
    resolveWebSearchConfig.mockReturnValue({ enabled: false, provider: "duckduckgo" });
    const { POST } = await import("../route");
    const response = await POST(request({ query: "latest news" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toContain("管理员已关闭");
    expect(executeWebSearch).not.toHaveBeenCalled();
  });

  it("counts both attempts and reports the fallback provider without returning secrets", async () => {
    executeWebSearch.mockImplementation(
      async (...args: unknown[]) => {
        const diagnostics = args[4] as {
          beforeProviderAttempt?: (providerId: string) => Promise<void>;
          onProviderAttempt?: (attempt: {
            providerId: string;
            outcome: "ok" | "empty" | "failed";
            hitCount: number;
            durationMs: number;
          }) => void;
        };
        await diagnostics.beforeProviderAttempt?.("primary");
        diagnostics.onProviderAttempt?.({
          providerId: "primary",
          outcome: "failed",
          hitCount: 0,
          durationMs: 10,
        });
        await diagnostics.beforeProviderAttempt?.("fallback");
        diagnostics.onProviderAttempt?.({
          providerId: "fallback",
          outcome: "ok",
          hitCount: 1,
          durationMs: 8,
        });
        return [{ title: "Result", url: "https://example.invalid/result", snippet: "Summary" }];
      },
    );

    const { POST } = await import("../route");
    const response = await POST(request({ query: "latest news", max_results: 4 }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      ok: true,
      provider: "fallback",
      hits: [{ title: "Result", url: "https://example.invalid/result", snippet: "Summary" }],
    });
    expect(reserveTenantDailySearchProviderCall).toHaveBeenCalledTimes(2);
    expect(reserveTenantDailySearchProviderCall).toHaveBeenNthCalledWith(1, "tenant-1");
    expect(JSON.stringify(json)).not.toContain("server-only");
    expect(json).not.toHaveProperty("providers");
  });

  it("maps an exhausted tenant quota without trying an unmanaged fallback", async () => {
    const quotaError = {
      reason: "exhausted",
      userMessage: "今日联网搜索额度已用完，请联系管理员调整",
    };
    executeWebSearch.mockRejectedValue(quotaError);
    isTenantDailySearchProviderQuotaExceeded.mockImplementation(
      (error: unknown) => error === quotaError,
    );

    const { POST } = await import("../route");
    const response = await POST(request({ query: "latest news" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toContain("额度已用完");
  });
});

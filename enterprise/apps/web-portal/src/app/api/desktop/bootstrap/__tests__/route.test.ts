import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const listAvailableModelsForUser = vi.fn();
const loadDesktopSessionTokenLimits = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: (...args: unknown[]) => listAvailableModelsForUser(...args),
}));

vi.mock("../../../../../lib/desktop-token-policy", () => ({
  loadDesktopSessionTokenLimits: (...args: unknown[]) =>
    loadDesktopSessionTokenLimits(...args),
}));

describe("GET /api/desktop/bootstrap", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    listAvailableModelsForUser.mockReset();
    loadDesktopSessionTokenLimits.mockReset();
    listAvailableModelsForUser.mockResolvedValue([]);
    loadDesktopSessionTokenLimits.mockResolvedValue({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL = "https://gateway.example.invalid";
    process.env.NODE_ENV = "test";
  });

  it("returns gateway-direct transport for managed scopes", async () => {
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: "d1",
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat", "desktop:managed"],
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost:3000/api/desktop/bootstrap"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.apiBaseUrl).toBe("http://localhost:3000/api/desktop/v1");
    expect(json.data.inferenceApiBaseUrl).toBe("https://gateway.example.invalid/v1");
    expect(json.data.inferenceTransport).toBe("gateway-direct-v1");
    expect(json.data.reauthRequiredForDirect).toBe(false);
    expect(json.data.policy.tokenBudget).toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(loadDesktopSessionTokenLimits).toHaveBeenCalledWith("t1");
  });

  it("returns the authenticated tenant's configured conversation limits", async () => {
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u2",
      tenantId: "tenant-policy",
      deptId: null,
      email: "b@example.invalid",
      displayName: "B",
      tokenId: 2,
      scopes: ["workspace:chat", "desktop:managed"],
    });
    loadDesktopSessionTokenLimits.mockResolvedValue({
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    });

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost:3000/api/desktop/bootstrap"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(loadDesktopSessionTokenLimits).toHaveBeenCalledWith("tenant-policy");
    expect(json.data.policy.tokenBudget).toEqual({
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    });
  });

  it("keeps proxy transport for old PAT without desktop:managed", async () => {
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: "d1",
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat"],
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost:3000/api/desktop/bootstrap"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.apiBaseUrl).toBe("http://localhost:3000/api/desktop/v1");
    expect(json.data.inferenceApiBaseUrl).toBeUndefined();
    expect(json.data.reauthRequiredForDirect).toBe(true);
  });

  it("falls back to portal proxy when direct gateway base is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL;
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: "d1",
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat", "desktop:managed"],
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.example.com/api/desktop/bootstrap"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.apiBaseUrl).toBe("https://portal.example.com/api/desktop/v1");
    expect(json.data.inferenceApiBaseUrl).toBeUndefined();
    expect(json.data.inferenceTransport).toBeUndefined();
    expect(json.data.reauthRequiredForDirect).toBe(true);
  });

  it("returns client-facing api base behind reverse proxy", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL;
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: "d1",
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat", "desktop:managed"],
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("http://0.0.0.0:3000/api/desktop/bootstrap", {
      headers: {
        host: "test-pal.cmccfund.com:3000",
        "x-forwarded-proto": "https",
      },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.apiBaseUrl).toBe("https://test-pal.cmccfund.com:3000/api/desktop/v1");
    expect(json.data.inferenceApiBaseUrl).toBeUndefined();
    expect(json.data.reauthRequiredForDirect).toBe(true);
  });
});

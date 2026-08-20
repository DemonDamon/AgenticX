import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const listAvailableModelsForUser = vi.fn();
const loadDesktopSessionTokenLimits = vi.fn();
const listAvailableCapabilitiesForUser = vi.fn();
const isPlatformFeatureAllowedOnSurface = vi.fn();

vi.mock("../../../../../lib/capability-packs-reader", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../lib/capability-packs-reader")
  >("../../../../../lib/capability-packs-reader");
  return {
    ...actual,
    listAvailableCapabilitiesForUser: (...args: unknown[]) =>
      listAvailableCapabilitiesForUser(...args),
    isPlatformFeatureAllowedOnSurface: (...args: unknown[]) =>
      isPlatformFeatureAllowedOnSurface(...args),
  };
});

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: (...args: unknown[]) => listAvailableModelsForUser(...args),
}));

vi.mock("../../../../../lib/desktop-token-policy", () => ({
  loadDesktopManagedPolicy: async (...args: unknown[]) => ({
    tokenLimits: await loadDesktopSessionTokenLimits(...args),
    capabilities: {
      allowLocalSkillInstall: true,
      allowLocalMcpInstall: true,
      allowMcpAutoDiscovery: true,
    },
  }),
  loadDesktopSessionTokenLimits: (...args: unknown[]) =>
    loadDesktopSessionTokenLimits(...args),
}));

describe("GET /api/desktop/bootstrap", { timeout: 30_000 }, () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    listAvailableModelsForUser.mockReset();
    loadDesktopSessionTokenLimits.mockReset();
    listAvailableModelsForUser.mockResolvedValue([]);
    listAvailableCapabilitiesForUser.mockReset().mockResolvedValue([]);
    isPlatformFeatureAllowedOnSurface.mockReset().mockResolvedValue(false);
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

  it("returns the authenticated tenant's configured conversation alert thresholds", async () => {
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


const PRIVATE_QWEN = {
  id: "qwen_local/qwen3.8-27b",
  provider: "qwen_local",
  providerLabel: "本地推理",
  model: "qwen3.8-27b",
  label: "本地推理/Qwen3.8 27B",
  route: "direct" as const,
  isDefault: false,
  capabilities: ["text", "vision", "private-deployment"],
};

describe("GET /api/desktop/bootstrap · 附件路由", { timeout: 30_000 }, () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset().mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      email: "u1@example.invalid",
      deptId: null,
      displayName: "U1",
      scopes: ["desktop:managed"],
    });
    listAvailableModelsForUser.mockReset().mockResolvedValue([PRIVATE_QWEN]);
    loadDesktopSessionTokenLimits.mockReset().mockResolvedValue({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    listAvailableCapabilitiesForUser.mockReset().mockResolvedValue([]);
    isPlatformFeatureAllowedOnSurface.mockReset();
    process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL = "https://gateway.example.invalid";
    process.env.NODE_ENV = "test";
  });

  async function bootstrapPayload() {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://portal.example.invalid/api/desktop/bootstrap"),
    );
    return (await response.json()).data as Record<string, any>;
  }

  it("ships the policy when the user is authorized and a private model is visible", async () => {
    isPlatformFeatureAllowedOnSurface.mockResolvedValue(true);
    const data = await bootstrapPayload();
    expect(data.attachmentRouting.enabled).toBe(true);
    expect(data.attachmentRouting.documentTarget).toEqual({
      id: "qwen_local/qwen3.8-27b",
      provider: "qwen_local",
      model: "qwen3.8-27b",
      label: "本地推理/Qwen3.8 27B",
    });
    // 图片不锁会话模型：截图是高频动作，切一次模型整段历史的 prefix cache 就废了。
    expect(data.attachmentRouting.imageStrategy).toBe("vision-fallback");
    expect(data.attachmentRouting.visionFallback.provider).toBe("qwen_local");
  });

  it("ships a disabled policy when the user is not authorized", async () => {
    isPlatformFeatureAllowedOnSurface.mockResolvedValue(false);
    const data = await bootstrapPayload();
    expect(data.attachmentRouting.enabled).toBe(false);
    expect(data.attachmentRouting.documentTarget).toBeNull();
  });

  it("fails closed when the authorization lookup throws", async () => {
    // 与 deep_research 的 fail-open 相反：这是新功能，没有存量租户在依赖它，查不动
    // 时保持原样远好过把会话锁到某个模型。
    isPlatformFeatureAllowedOnSurface.mockRejectedValue(new Error("db down"));
    const data = await bootstrapPayload();
    expect(data.attachmentRouting.enabled).toBe(false);
  });

  it("only asks for desktop-surface capabilities", async () => {
    isPlatformFeatureAllowedOnSurface.mockResolvedValue(true);
    await bootstrapPayload();
    expect(listAvailableCapabilitiesForUser).toHaveBeenCalledWith(
      "u1",
      "u1@example.invalid",
      null,
      "desktop",
    );
  });
});

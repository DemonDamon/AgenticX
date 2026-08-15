import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionAuthFromCookies: vi.fn(),
  isChatSessionOwned: vi.fn(),
  listAvailableModelsForUser: vi.fn(),
  loadTenantWebSearchConfig: vi.fn(),
  loadTenantWebSearchConfigStrict: vi.fn(),
  planAutomaticTurn: vi.fn(),
  resolveManualDeepResearchQuery: vi.fn(),
  runDeepResearchTurn: vi.fn(),
  runWebSearchTurn: vi.fn(),
  withCalculatorContext: vi.fn(),
}));

vi.mock("../../../../../lib/session", () => ({
  ACCESS_COOKIE: "agx_access",
  REFRESH_COOKIE: "agx_refresh",
  getSessionAuthFromCookies: mocks.getSessionAuthFromCookies,
  isAuthCookieSecure: () => false,
  passwordChangeRequiredResponse: () => Response.json({}, { status: 403 }),
}));

vi.mock("../../../../../lib/auth-runtime", () => ({ refreshTokens: vi.fn() }));
vi.mock("../../../../../lib/chat-history", () => ({
  isChatSessionOwned: mocks.isChatSessionOwned,
}));
vi.mock("../../../../../lib/chat-history-http", () => ({
  toChatHistoryContext: (session: { tenantId: string; userId: string }) => ({
    tenantId: session.tenantId,
    userId: session.userId,
  }),
}));
vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: mocks.listAvailableModelsForUser,
}));
vi.mock("../../../../../lib/web-search/tool-loop", () => ({
  resolveStandaloneSearchQuery: vi.fn(),
  runWebSearchTurn: mocks.runWebSearchTurn,
}));
vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: mocks.loadTenantWebSearchConfig,
  loadTenantWebSearchConfigStrict: mocks.loadTenantWebSearchConfigStrict,
}));
vi.mock("../../../../../lib/deep-research/orchestrator", () => ({
  runDeepResearchTurn: mocks.runDeepResearchTurn,
}));
vi.mock("../../../../../lib/deep-research/artifact-store", () => ({
  defaultArtifactStore: {},
}));
vi.mock("../../../../../lib/deep-research/auto-need", () => ({
  planAutomaticTurn: mocks.planAutomaticTurn,
  resolveManualDeepResearchQuery: mocks.resolveManualDeepResearchQuery,
}));
vi.mock("../../../../../lib/calculator/chat-context", () => ({
  withCalculatorContext: mocks.withCalculatorContext,
}));

import { POST } from "../route";

const session = {
  userId: "user-1",
  tenantId: "tenant-1",
  deptId: "dept-1",
  email: "user@example.com",
  scopes: [],
  mustChangePassword: false,
  sessionId: "auth-session-1",
};

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chat-session-id": "chat-session-1",
    },
    body: JSON.stringify({
      model: "provider-a/model-a",
      stream: true,
      messages: [{ role: "user", content: "当前问题" }],
      ...body,
    }),
  });
}

describe("POST /api/chat/completions deep-research preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionAuthFromCookies.mockResolvedValue({
      session,
      accessToken: "access-token",
      refreshToken: null,
    });
    mocks.isChatSessionOwned.mockResolvedValue(true);
    mocks.listAvailableModelsForUser.mockResolvedValue([
      { id: "provider-a/model-a", provider: "provider-a", model: "model-a" },
    ]);
    mocks.loadTenantWebSearchConfig.mockResolvedValue({
      enabled: true,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 5,
      maxSearchCalls: 3,
      deepResearchEnabled: true,
    });
    mocks.loadTenantWebSearchConfigStrict.mockResolvedValue({
      enabled: true,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 5,
      maxSearchCalls: 3,
      deepResearchEnabled: true,
    });
    mocks.runDeepResearchTurn.mockResolvedValue(new Response("deep"));
    mocks.runWebSearchTurn.mockResolvedValue(new Response("web"));
    mocks.planAutomaticTurn.mockResolvedValue({
      kind: "fallback",
      reason: "classifier_unavailable",
    });
    mocks.withCalculatorContext.mockResolvedValue(null);
  });

  it("gives manual activation priority and skips the automatic gate", async () => {
    mocks.resolveManualDeepResearchQuery.mockResolvedValue({
      kind: "resolved",
      value: { query: "补全后的研究请求", confidence: 0.95, source: "ai" },
    });

    const response = await POST(request({
      agenticx_deep_research: true,
      agenticx_deep_research_auto: true,
    }));

    expect(await response.text()).toBe("deep");
    expect(mocks.planAutomaticTurn).not.toHaveBeenCalled();
    expect(mocks.withCalculatorContext).not.toHaveBeenCalled();
    expect(mocks.resolveManualDeepResearchQuery).toHaveBeenCalledTimes(1);
    expect(mocks.runDeepResearchTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        resolvedUserQuery: "补全后的研究请求",
        intentConfidence: { routeConfidence: 1, queryConfidence: 0.95 },
      }),
    );
  });

  it("rejects a textless manual request instead of silently answering normally", async () => {
    mocks.resolveManualDeepResearchQuery.mockResolvedValue({
      kind: "unresolved",
      reason: "missing_current_query",
    });

    const response = await POST(request({ agenticx_deep_research: true }));

    expect(response.status).toBe(400);
    expect(mocks.runDeepResearchTurn).not.toHaveBeenCalled();
    expect(mocks.runWebSearchTurn).not.toHaveBeenCalled();
  });

  it("uses one automatic decision and passes its resolved query directly", async () => {
    mocks.planAutomaticTurn.mockResolvedValue({
      kind: "planned",
      plan: {
        mode: "deep",
        researchQuery: "两位人物截至当前日期的近期风评变化",
        intentConfidence: { routeConfidence: 0.94, queryConfidence: 0.96 },
        reason: "需要多源趋势核验",
      },
    });

    const response = await POST(request({ agenticx_deep_research_auto: true }));

    expect(await response.text()).toBe("deep");
    expect(mocks.planAutomaticTurn).toHaveBeenCalledTimes(1);
    expect(mocks.planAutomaticTurn).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      { allowWebSearch: false, maxSearchCalls: 3 },
    );
    expect(mocks.resolveManualDeepResearchQuery).not.toHaveBeenCalled();
    expect(mocks.runDeepResearchTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        resolvedUserQuery: "两位人物截至当前日期的近期风评变化",
        intentConfidence: { routeConfidence: 0.94, queryConfidence: 0.96 },
      }),
    );
  });

  it("keeps a manual fallback on the clarification-safe path", async () => {
    mocks.resolveManualDeepResearchQuery.mockResolvedValue({
      kind: "resolved",
      value: { query: "当前问题", confidence: 0, source: "fallback" },
    });

    const response = await POST(request({ agenticx_deep_research: true }));

    expect(await response.text()).toBe("deep");
    expect(mocks.runDeepResearchTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        resolvedUserQuery: "当前问题",
        intentConfidence: { routeConfidence: 1, queryConfidence: 0 },
      }),
    );
  });

  it("passes an automatic web plan directly to ordinary search", async () => {
    const searchPlan = {
      query: "补全后的当前问题",
      needSearch: true as const,
      searchQueries: ["补全后的当前问题"],
      confidence: 0.98,
      source: "auto-route" as const,
    };
    mocks.planAutomaticTurn.mockResolvedValue({
      kind: "planned",
      plan: {
        mode: "web",
        searchPlan,
        reason: "单次检索足够",
      },
    });

    const response = await POST(request({
      agenticx_web_search: true,
      agenticx_deep_research_auto: true,
    }));

    expect(await response.text()).toBe("web");
    expect(mocks.planAutomaticTurn).toHaveBeenCalledTimes(1);
    expect(mocks.planAutomaticTurn).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      { allowWebSearch: true, maxSearchCalls: 3 },
    );
    expect(mocks.resolveManualDeepResearchQuery).not.toHaveBeenCalled();
    expect(mocks.runDeepResearchTurn).not.toHaveBeenCalled();
    expect(mocks.withCalculatorContext).not.toHaveBeenCalled();
    expect(mocks.runWebSearchTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { preparedSearchPlan: searchPlan },
    );
  });

  it("uses plain chat directly when the automatic planner selects plain", async () => {
    mocks.planAutomaticTurn.mockResolvedValue({
      kind: "planned",
      plan: { mode: "plain", reason: "现有上下文足够" },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("plain"),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await POST(request({
        agenticx_web_search: true,
        agenticx_deep_research_auto: true,
      }));

      expect(await response.text()).toBe("plain");
      expect(mocks.planAutomaticTurn).toHaveBeenCalledTimes(1);
      expect(mocks.runWebSearchTurn).not.toHaveBeenCalled();
      expect(mocks.runDeepResearchTurn).not.toHaveBeenCalled();
      expect(mocks.withCalculatorContext).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards calculator-enriched context only on the ordinary chat path", async () => {
    mocks.withCalculatorContext.mockImplementation(async (body: Record<string, unknown>) => ({
      ...body,
      messages: [
        { role: "system", content: "deterministic-result: 0.3" },
        ...(body.messages as unknown[]),
      ],
    }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("plain"),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await POST(request({
        messages: [{ role: "user", content: "请计算 0.1 + 0.2" }],
      }));

      expect(await response.text()).toBe("plain");
      expect(mocks.withCalculatorContext).toHaveBeenCalledWith(
        expect.objectContaining({ model: "model-a" }),
        expect.objectContaining({
          url: expect.stringContaining("/v1/chat/completions"),
          headers: expect.objectContaining({ "x-agenticx-provider": "provider-a" }),
        }),
      );
      const forwarded = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
      expect(forwarded.messages[0]).toEqual({
        role: "system",
        content: "deterministic-result: 0.3",
      });
      expect(mocks.runWebSearchTurn).not.toHaveBeenCalled();
      expect(mocks.runDeepResearchTurn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the established ordinary web planner when automatic planning fails", async () => {
    mocks.planAutomaticTurn.mockResolvedValue({
      kind: "fallback",
      reason: "invalid_output",
    });

    const response = await POST(request({
      agenticx_web_search: true,
      agenticx_deep_research_auto: true,
    }));

    expect(await response.text()).toBe("web");
    expect(mocks.runDeepResearchTurn).not.toHaveBeenCalled();
    expect(mocks.runWebSearchTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      {},
    );
  });

  it("skips the automatic model call when the tenant disables deep research", async () => {
    mocks.loadTenantWebSearchConfigStrict.mockResolvedValue({
      enabled: true,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 5,
      deepResearchEnabled: false,
    });

    const response = await POST(request({
      agenticx_web_search: true,
      agenticx_deep_research_auto: true,
    }));

    expect(await response.text()).toBe("web");
    expect(mocks.planAutomaticTurn).not.toHaveBeenCalled();
    expect(mocks.resolveManualDeepResearchQuery).not.toHaveBeenCalled();
  });

  it("does not spend a rewrite call for a tenant-disabled manual request", async () => {
    mocks.loadTenantWebSearchConfigStrict.mockResolvedValue({
      enabled: true,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 5,
      deepResearchEnabled: false,
    });

    const response = await POST(request({ agenticx_deep_research: true }));

    expect(await response.text()).toBe("deep");
    expect(mocks.planAutomaticTurn).not.toHaveBeenCalled();
    expect(mocks.resolveManualDeepResearchQuery).not.toHaveBeenCalled();
    expect(mocks.runDeepResearchTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantConfig: expect.objectContaining({ deepResearchEnabled: false }),
      }),
    );
  });

  it("rejects an ambiguous bare model before any routing call", async () => {
    mocks.listAvailableModelsForUser.mockResolvedValue([
      { id: "provider-a/model-a", provider: "provider-a", model: "model-a" },
      { id: "provider-b/model-a", provider: "provider-b", model: "model-a" },
    ]);

    const response = await POST(request({
      model: "model-a",
      agenticx_deep_research_auto: true,
    }));

    expect(response.status).toBe(403);
    expect(mocks.planAutomaticTurn).not.toHaveBeenCalled();
  });

  it("fails closed when effective model policy cannot be read", async () => {
    mocks.listAvailableModelsForUser.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request({ agenticx_deep_research_auto: true }));

    expect(response.status).toBe(503);
    expect(mocks.loadTenantWebSearchConfigStrict).not.toHaveBeenCalled();
    expect(mocks.planAutomaticTurn).not.toHaveBeenCalled();
  });

  it("skips automatic deep research when tenant policy cannot be read", async () => {
    mocks.loadTenantWebSearchConfigStrict.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(request({
      agenticx_web_search: true,
      agenticx_deep_research_auto: true,
    }));

    expect(await response.text()).toBe("web");
    expect(mocks.planAutomaticTurn).not.toHaveBeenCalled();
    expect(mocks.runWebSearchTurn).toHaveBeenCalledTimes(1);
  });

  it("rejects manual deep research when tenant policy cannot be read", async () => {
    mocks.loadTenantWebSearchConfigStrict.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(request({ agenticx_deep_research: true }));

    expect(response.status).toBe(503);
    expect(mocks.resolveManualDeepResearchQuery).not.toHaveBeenCalled();
    expect(mocks.runDeepResearchTurn).not.toHaveBeenCalled();
  });
});

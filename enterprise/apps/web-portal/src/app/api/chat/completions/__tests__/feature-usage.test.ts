import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureUsageLimitError } from "../../../../../lib/feature-usage/errors";

const admitFeatureUsage = vi.hoisted(() => vi.fn());
const reserveMemberSearchProviderCall = vi.hoisted(() => vi.fn());
const researchUsagePolicy = vi.hoisted(() => vi.fn());
const executeWebSearch = vi.hoisted(() => vi.fn());

vi.mock("@agenticx/iam-core", () => ({
  loadAuthUserByEmail: vi.fn(),
  listUserOptOuts: vi.fn(async () => []),
  resolveAssignmentKeysForUser: vi.fn(async () => ["all"]),
  listUserGroupIdsForUser: vi.fn(async () => []),
  getUserRolesDetail: vi.fn(async () => ({ roleCodes: ["member"], scopes: [] })),
  resolveDatabaseConfig: () => ({ dialect: "postgresql" }),
  getIamDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  }),
  createMysqlDb: vi.fn(),
}));

vi.mock("../../../../../lib/session", () => ({
  ACCESS_COOKIE: "access",
  REFRESH_COOKIE: "refresh",
  getSessionAuthFromCookies: vi.fn(),
  isAuthCookieSecure: vi.fn(() => false),
}));

vi.mock("../../../../../lib/chat-history", () => ({
  isChatSessionOwned: vi.fn(),
}));

vi.mock("../../../../../lib/chat-history-http", () => ({
  toChatHistoryContext: vi.fn((session: unknown) => session),
}));

vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: vi.fn(async () => [{ id: "openai/gpt-4o-mini" }]),
}));

vi.mock("../../../../../lib/auth-runtime", () => ({
  refreshTokens: vi.fn(),
}));

vi.mock("../../../../../lib/deep-research/orchestrator", () => ({
  runDeepResearchTurn: vi.fn(async () => new Response("deep", { status: 200 })),
  TOTAL_BUDGET_MS: 1_200_000,
  CLARIFY_TIMEOUT_MS: 300_000,
}));

vi.mock("../../../../../lib/deep-research/artifact-store", () => ({
  defaultArtifactStore: {},
}));

vi.mock("../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: {
    create: vi.fn(),
    appendEvents: vi.fn(),
    appendReport: vi.fn(),
    setCitations: vi.fn(),
    finish: vi.fn(),
    reopenForContinue: vi.fn(),
    get: vi.fn(),
    listActive: vi.fn(),
    getLatestBySession: vi.fn(),
    reapStaleRuns: vi.fn(),
  },
}));

vi.mock("../../../../../lib/web-search/tool-loop", () => ({
  runWebSearchTurn: vi.fn(async () => new Response("search", { status: 200 })),
}));

vi.mock("../../../../../lib/web-search/providers", () => ({
  executeWebSearch,
}));

vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: vi.fn(),
}));

vi.mock("../../../../../lib/portal-locale", () => ({
  resolvePortalLocaleFromCookies: vi.fn(async () => "zh"),
}));

vi.mock("../../../../../lib/capability-packs-reader", () => ({
  isPlatformFeatureAllowedForUser: vi.fn(async () => true),
}));

vi.mock("../../../../../lib/feature-usage/subject", () => ({
  featureUsageSubject: vi.fn(async () => ({
    tenantId: "t1",
    userId: "u1",
    deptId: "d1",
    roles: ["member"],
    groupIds: [],
  })),
}));

vi.mock("../../../../../lib/feature-usage/gate", async () => {
  const actual = await vi.importActual<typeof import("../../../../../lib/feature-usage/gate")>(
    "../../../../../lib/feature-usage/gate",
  );
  return {
    ...actual,
    admitFeatureUsage,
    featureUsageCountingRequired: vi.fn(async () => true),
    reserveMemberSearchProviderCall,
    researchUsagePolicy,
  };
});

import { getSessionAuthFromCookies } from "../../../../../lib/session";
import { isChatSessionOwned } from "../../../../../lib/chat-history";
import { runWebSearchTurn } from "../../../../../lib/web-search/tool-loop";
import { runDeepResearchTurn } from "../../../../../lib/deep-research/orchestrator";
import { POST } from "../route";

const session = {
  userId: "u1",
  tenantId: "t1",
  email: "u@example.com",
  deptId: "d1",
  sessionId: "auth-sess",
  scopes: ["workspace:chat"],
};

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chat-session-id": "chat-1",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "今天的新闻" }],
      ...body,
    }),
  });
}

describe("chat completions feature usage", () => {
  beforeEach(() => {
    admitFeatureUsage.mockReset();
    reserveMemberSearchProviderCall.mockReset();
    researchUsagePolicy.mockReset();
    executeWebSearch.mockReset();
    admitFeatureUsage.mockResolvedValue({ unlimited: true, binding: null });
    reserveMemberSearchProviderCall.mockResolvedValue(undefined);
    researchUsagePolicy.mockResolvedValue({
      deptId: "d1",
      policies: {
        personal: { limits: { day: 1, week: 0, month: 0 }, source: "default" },
        department: { limits: { day: 0, week: 0, month: 0 }, source: "none" },
        company: { limits: { day: 0, week: 0, month: 0 }, source: "none" },
      },
    });
    vi.mocked(getSessionAuthFromCookies).mockResolvedValue({
      session,
      accessToken: `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3 * 60 * 60 })).toString("base64url")}.s`,
      refreshToken: "ref",
    } as never);
    vi.mocked(isChatSessionOwned).mockResolvedValue(true);
    vi.mocked(runWebSearchTurn).mockReset();
    vi.mocked(runWebSearchTurn).mockResolvedValue(new Response("search", { status: 200 }));
    vi.mocked(runDeepResearchTurn).mockReset();
    vi.mocked(runDeepResearchTurn).mockResolvedValue(new Response("deep", { status: 200 }));
  });

  it("returns the search limit message and does not call the search service", async () => {
    admitFeatureUsage.mockRejectedValue(new FeatureUsageLimitError("search_provider_calls", {
      window: "day",
      limit: 3,
      used: 3,
      remaining: 0,
      source: "user",
    }));
    const res = await POST(request({ agenticx_web_search: true }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("今日联网搜索次数已用完");
    expect(runWebSearchTurn).not.toHaveBeenCalled();
    expect(executeWebSearch).not.toHaveBeenCalled();
  });

  it("counts a search call before the provider and skips the provider when the reserve fails", async () => {
    reserveMemberSearchProviderCall.mockRejectedValue(new FeatureUsageLimitError("search_provider_calls", {
      window: "day",
      limit: 3,
      used: 3,
      remaining: 0,
      source: "department",
    }));
    vi.mocked(runWebSearchTurn).mockImplementation(async (_body, deps) => {
      await deps.executeSearch?.("今天的新闻", undefined, {
        provider: "duckduckgo",
        apiKey: "",
        maxResults: 5,
      });
      return new Response("should-not-stream", { status: 200 });
    });

    const res = await POST(request({ agenticx_web_search: true }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("今日联网搜索次数已用完");
    expect(executeWebSearch).not.toHaveBeenCalled();
  });

  it("does not start a research turn when the run ceiling is already full", async () => {
    admitFeatureUsage.mockImplementation(async (feature: string) => {
      if (feature === "deep_research_runs") {
        throw new FeatureUsageLimitError("deep_research_runs", {
          window: "day",
          limit: 1,
          used: 1,
          remaining: 0,
          source: "default",
        });
      }
      return { unlimited: true, binding: null };
    });
    const res = await POST(request({ agenticx_deep_research: true }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("今日深度研究次数已用完");
    expect(runDeepResearchTurn).not.toHaveBeenCalled();
  });

  it("passes usage into run creation and a counted search into the research lane", async () => {
    const res = await POST(request({ agenticx_deep_research: true }));
    expect(res.status).toBe(200);
    expect(runDeepResearchTurn).toHaveBeenCalled();
    const deps = vi.mocked(runDeepResearchTurn).mock.calls[0]?.[1] as {
      executeSearch?: (query: string, maxResults: number | undefined, cfg: {
        provider: string;
        apiKey: string;
        maxResults: number;
      }) => Promise<unknown>;
      runStore?: { create: (input: { usage?: unknown }) => Promise<unknown> };
    };
    expect(deps.executeSearch).toEqual(expect.any(Function));
    expect(deps.runStore?.create).toEqual(expect.any(Function));
    executeWebSearch.mockResolvedValue([]);
    await deps.executeSearch?.("q", undefined, { provider: "duckduckgo", apiKey: "", maxResults: 5 });
    expect(reserveMemberSearchProviderCall).toHaveBeenCalled();
    expect(executeWebSearch).toHaveBeenCalledTimes(1);
  });

  it("says the search count cannot be confirmed when the counter is unreadable", async () => {
    const { FeatureUsageUnavailableError } = await import("../../../../../lib/feature-usage/errors");
    admitFeatureUsage.mockRejectedValue(new FeatureUsageUnavailableError("search_provider_calls"));
    const res = await POST(request({ agenticx_web_search: true }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("暂时无法确认搜索次数，请稍后再试");
    expect(executeWebSearch).not.toHaveBeenCalled();
  });
});

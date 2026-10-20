import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getRun: vi.fn(),
  owned: vi.fn(),
  models: vi.fn(),
  feature: vi.fn(),
  config: vi.fn(),
  load: vi.fn(),
  start: vi.fn(),
  refreshTokens: vi.fn(),
  admit: vi.fn(),
  reserveSearch: vi.fn(),
  subject: vi.fn(),
  search: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn() }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("../../../../../lib/session", () => ({
  getSessionAuthFromCookies: mocks.auth,
  passwordChangeRequiredResponse: () => new Response(null, { status: 403 }),
  ACCESS_COOKIE: "access",
  REFRESH_COOKIE: "refresh",
  isAuthCookieSecure: () => false,
}));
vi.mock("../../../../../lib/auth-runtime", () => ({ refreshTokens: mocks.refreshTokens }));
vi.mock("../../../../../lib/chat-history", () => ({ isChatSessionOwned: mocks.owned }));
vi.mock("../../../../../lib/chat-history-http", () => ({ toChatHistoryContext: (session: unknown) => session }));
vi.mock("../../../../../lib/admin-providers-reader", () => ({ listAvailableModelsForUser: mocks.models }));
vi.mock("../../../../../lib/capability-packs-reader", () => ({
  isPlatformFeatureAllowedForUser: mocks.feature,
}));
vi.mock("../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: { get: mocks.getRun },
}));
vi.mock("../../../../../lib/deep-research/artifact-store", () => ({ defaultArtifactStore: {} }));
vi.mock("../../../../../lib/deep-research/report-checkpoint", () => ({
  loadReportCheckpoint: mocks.load,
}));
vi.mock("../../../../../lib/deep-research/orchestrator", () => ({
  continueFromReport: mocks.start,
  TOTAL_BUDGET_MS: 1_200_000,
  CLARIFY_TIMEOUT_MS: 300_000,
}));
vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: mocks.config,
}));
vi.mock("../../../../../lib/web-search/providers", () => ({ executeWebSearch: mocks.search }));
vi.mock("../../../../../lib/feature-usage/gate", () => ({
  admitFeatureUsage: mocks.admit,
  reserveMemberSearchProviderCall: mocks.reserveSearch,
  FeatureUsageUnavailableError: class FeatureUsageUnavailableError extends Error {},
}));
vi.mock("../../../../../lib/feature-usage/subject", () => ({
  featureUsageSubject: mocks.subject,
}));
vi.mock("../../../../../lib/portal-locale", () => ({
  resolvePortalLocaleFromCookies: async () => "zh",
}));
vi.mock("../../../../../lib/observability/with-request-log", () => ({
  withRequestLog: (_name: string, handler: (ctx: {
    setUser: () => void;
    setMode: () => void;
    setRun: () => void;
    traceId: string;
  }) => Promise<Response>) => handler({
    setUser: vi.fn(),
    setMode: vi.fn(),
    setRun: vi.fn(),
    traceId: "fresh-trace",
  }),
}));

import { POST } from "./route";

const session = {
  tenantId: "t",
  userId: "u",
  sessionId: "auth-session",
  email: "user@example.com",
  deptId: "d",
  scopes: ["staff"],
  mustChangePassword: false,
};
const run = {
  runId: "old",
  sessionId: "chat",
  status: "failed",
  traceId: "old-trace",
};
const saved = {
  sourceRunId: "old",
  nextRunId: "new",
  model: "m",
  provider: "p",
  topic: "主题",
  messages: [{ role: "user", content: "原始提问" }],
};
const request = () => new Request("http://localhost/api/chat/deep-research/continue", {
  method: "POST",
  body: JSON.stringify({ runId: "old", model: "attacker/model" }),
});
const jwt = (remainingMs: number) => `header.${Buffer.from(JSON.stringify({
  sessionId: "auth-session",
  exp: Math.floor((Date.now() + remainingMs) / 1000),
})).toString("base64url")}.signature`;
const fixtureRefresh = "refresh-token";

describe("manual report continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ session, accessToken: jwt(60 * 60_000), refreshToken: fixtureRefresh });
    mocks.getRun.mockImplementation(async (_tenant: string, _user: string, id: string) => (
      id === "old" ? run : null
    ));
    mocks.owned.mockResolvedValue(true);
    mocks.load.mockResolvedValue(saved);
    mocks.models.mockResolvedValue([{ id: "p/m", model: "m", provider: "p", route: "local" }]);
    mocks.feature.mockResolvedValue(true);
    mocks.config.mockResolvedValue({ deepResearchEnabled: true, enabled: true });
    mocks.start.mockResolvedValue(new Response("data: [DONE]\n\n"));
    mocks.subject.mockResolvedValue({ tenantId: "t", userId: "u" });
    mocks.admit.mockResolvedValue(undefined);
    mocks.reserveSearch.mockResolvedValue(undefined);
    mocks.search.mockResolvedValue([]);
  });

  it("returns 409 when the run has no checkpoint", async () => {
    mocks.load.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("returns the same next run when continuation is requested twice", async () => {
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({ runId: "new", traceId: "fresh-trace" });
    mocks.getRun.mockImplementation(async (_tenant: string, _user: string, id: string) => {
      if (id === "old") return run;
      if (id === "new") return { runId: "new", traceId: "durable-trace" };
      return null;
    });
    const second = await POST(request());
    expect((await second.json()).data).toMatchObject({ runId: "new", traceId: "durable-trace" });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for another user's run", async () => {
    mocks.getRun.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    mocks.getRun.mockResolvedValue(run);
    mocks.owned.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("does not charge another research use and counts any search through the shared wrapper", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const deps = mocks.start.mock.calls[0]?.[1] as {
      executeSearch: (query: string, maxResults: number, cfg: unknown, fetchImpl: typeof fetch) => Promise<unknown>;
      runId: string;
      usage?: unknown;
    };
    expect(deps.runId).toBe("new");
    expect(deps).not.toHaveProperty("usage");
    expect(mocks.start.mock.calls[0]?.[0]).toEqual(saved);
    await deps.executeSearch("query", 3, {}, fetch);
    expect(mocks.admit).toHaveBeenCalledWith("search_provider_calls", { tenantId: "t", userId: "u" });
    expect(mocks.reserveSearch).toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalled();
  });
});

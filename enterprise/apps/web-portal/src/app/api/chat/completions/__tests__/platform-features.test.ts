import { beforeEach, describe, expect, it, vi } from "vitest";

const isPlatformFeatureAllowedForUser = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  loadAuthUserByEmail: vi.fn(),
  listUserOptOuts: vi.fn(async () => []),
  resolveAssignmentKeysForUser: vi.fn(async () => ["all"]),
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
}));

vi.mock("../../../../../lib/deep-research/artifact-store", () => ({
  defaultArtifactStore: {},
}));

vi.mock("../../../../../lib/web-search/tool-loop", () => ({
  runWebSearchTurn: vi.fn(async () => new Response("search", { status: 200 })),
}));

vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: vi.fn(),
}));

vi.mock("../../../../../lib/capability-packs-reader", () => ({
  isPlatformFeatureAllowedForUser: (...args: unknown[]) => isPlatformFeatureAllowedForUser(...args),
}));

import { getSessionAuthFromCookies } from "../../../../../lib/session";
import { isChatSessionOwned } from "../../../../../lib/chat-history";
import { runWebSearchTurn } from "../../../../../lib/web-search/tool-loop";
import { runDeepResearchTurn } from "../../../../../lib/deep-research/orchestrator";

const session = {
  userId: "u1",
  tenantId: "t1",
  email: "u@example.com",
  deptId: "d1",
  sessionId: "auth-sess",
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
      messages: [{ role: "user", content: "hi" }],
      ...body,
    }),
  });
}

describe("chat completions platform feature authorization", () => {
  beforeEach(() => {
    isPlatformFeatureAllowedForUser.mockReset();
    vi.mocked(getSessionAuthFromCookies).mockResolvedValue({
      session,
      accessToken: "tok",
      refreshToken: "ref",
    } as never);
    vi.mocked(isChatSessionOwned).mockResolvedValue(true);
    vi.mocked(runWebSearchTurn).mockClear();
    vi.mocked(runDeepResearchTurn).mockClear();
  });

  it("rejects web search when the user is not assigned the feature", async () => {
    isPlatformFeatureAllowedForUser.mockResolvedValue(false);
    const { POST } = await import("../route");
    const res = await POST(request({ agenticx_web_search: true }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("40303");
    expect(body.error?.message).toMatch(/联网搜索/);
    expect(runWebSearchTurn).not.toHaveBeenCalled();
  });

  it("rejects deep research when the user is not assigned the feature", async () => {
    isPlatformFeatureAllowedForUser.mockResolvedValue(false);
    const { POST } = await import("../route");
    const res = await POST(request({ agenticx_deep_research: true }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/深度研究/);
    expect(runDeepResearchTurn).not.toHaveBeenCalled();
  });

  it("lets an assigned user start web search", async () => {
    isPlatformFeatureAllowedForUser.mockResolvedValue(true);
    const { POST } = await import("../route");
    const res = await POST(request({ agenticx_web_search: true }));
    expect(res.status).toBe(200);
    expect(isPlatformFeatureAllowedForUser).toHaveBeenCalledWith(
      "web_search",
      "u1",
      "u@example.com",
      "d1",
    );
    expect(runWebSearchTurn).toHaveBeenCalled();
  });

  it("keeps ordinary chat off the platform-feature check", async () => {
    const { POST } = await import("../route");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    );
    const res = await POST(request({}));
    expect(res.status).toBe(200);
    expect(isPlatformFeatureAllowedForUser).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookiesSet }),
}));

vi.mock("../../../../../lib/session", () => ({
  ACCESS_COOKIE: "agx_access",
  REFRESH_COOKIE: "agx_refresh",
  isAuthCookieSecure: () => false,
  getSessionAuthFromCookies: vi.fn(),
}));

vi.mock("../../../../../lib/auth-runtime", () => ({
  refreshTokens: vi.fn(),
}));

vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: vi.fn(async () => ({ enabled: true, deepResearchEnabled: true })),
}));

vi.mock("../../../../../lib/deep-research/artifact-store", () => ({
  defaultArtifactStore: {},
}));

vi.mock("../../../../../lib/deep-research/run-wait", () => ({
  awaitPeerClarifyHandoff: vi.fn(),
  CHAT_CLARIFY_ANSWER_KEY: "__chat__",
  hasLiveClarifyWaiter: vi.fn(() => false),
  MAX_GATE_ANSWER_CHARS: 4000,
  MAX_PLAN_PATCH_CHARS: 8000,
  PLAN_GATE_ACTION_KEY: "__plan_action__",
  PLAN_GATE_PATCH_KEY: "__plan_patch__",
  resolveClarifyResume: vi.fn(() => false),
}));

const runDeepResearchTurn = vi.fn(async () => new Response("ok", { status: 200 }));
vi.mock("../../../../../lib/deep-research/orchestrator", async () => {
  const actual = await vi.importActual<typeof import("../../../../../lib/deep-research/orchestrator")>(
    "../../../../../lib/deep-research/orchestrator",
  );
  return {
    ...actual,
    runDeepResearchTurn: (...args: unknown[]) => runDeepResearchTurn(...args),
  };
});

const getRun = vi.fn();
const createRun = vi.fn();
const appendEvents = vi.fn();
const reopenForContinue = vi.fn();
vi.mock("../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: {
    get: (...args: unknown[]) => getRun(...args),
    create: (...args: unknown[]) => createRun(...args),
    appendEvents: (...args: unknown[]) => appendEvents(...args),
    reopenForContinue: (...args: unknown[]) => reopenForContinue(...args),
  },
}));

import { getSessionAuthFromCookies } from "../../../../../lib/session";
import { POST } from "./route";

const TID = "01JABCDEFGHJKMNPQRSTVWXYZA";

describe("deep-research resume trace_id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PORTAL_LOG_LEVEL", "error");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("passes x-agenticx-trace-id into runDeepResearchTurn deps", async () => {
    vi.mocked(getSessionAuthFromCookies).mockResolvedValue({
      session: {
        userId: "u1",
        tenantId: "t1",
        deptId: "d1",
        email: "u@example.com",
        sessionId: "auth-session",
      },
      accessToken: "access",
      refreshToken: "refresh",
    } as never);

    const plan = {
      version: 1,
      objective: "topic",
      scope: [],
      subQuestions: [{ id: "q1", title: "Q1" }],
      sourceStrategy: [],
      deliverables: [],
      assumptions: [],
    };

    getRun.mockResolvedValue({
      runId: "run-1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "chat-session",
      topic: "topic",
      status: "awaiting_clarify",
      phase: "plan",
      events: [
        {
          type: "research_plan",
          runId: "run-1",
          action: "proposed",
          version: 1,
          plan,
        },
      ],
    });
    appendEvents.mockResolvedValue(undefined);
    reopenForContinue.mockResolvedValue(true);

    const res = await POST(
      new Request("http://localhost/api/chat/deep-research/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agenticx-trace-id": TID,
        },
        body: JSON.stringify({
          runId: "run-1",
          answers: { __plan_action__: "approve" },
          model: "gpt-test",
        }),
      }),
    );

    expect(res.status).toBe(200);
    // background continue is fire-and-forget; wait a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(runDeepResearchTurn).toHaveBeenCalled();
    const deps = runDeepResearchTurn.mock.calls[0]?.[1] as {
      traceId?: string;
      headers?: Record<string, string>;
    };
    expect(deps.traceId).toBe(TID);
    expect(deps.headers?.["x-agenticx-trace-id"]).toBe(TID);
  });
});

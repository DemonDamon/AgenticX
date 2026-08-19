import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionAuthFromCookies = vi.fn();
const resolveClarification = vi.fn();
const getRun = vi.fn();
const claimPlanGateResume = vi.fn();
const appendEvents = vi.fn();
const beginClarification = vi.fn();
const notifyClarifyResume = vi.fn();
const hasLiveClarifyWaiter = vi.fn();
const orphanGateKind = vi.fn();
const latestResearchPlanEvent = vi.fn();
const snapshotToResearchPlan = vi.fn();
const toPlanSnapshot = vi.fn();
const runDeepResearchTurn = vi.fn();
const syncRevisePlanChat = vi.fn();

vi.mock("../../../../../../lib/session", () => ({
  getSessionAuthFromCookies: (...args: unknown[]) => getSessionAuthFromCookies(...args),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: {
    get: (...args: unknown[]) => getRun(...args),
    resolveClarification: (...args: unknown[]) => resolveClarification(...args),
    claimPlanGateResume: (...args: unknown[]) => claimPlanGateResume(...args),
    appendEvents: (...args: unknown[]) => appendEvents(...args),
    beginClarification: (...args: unknown[]) => beginClarification(...args),
  },
}));

vi.mock("../../../../../../lib/deep-research/artifact-store", () => ({
  defaultArtifactStore: {},
}));

vi.mock("../../../../../../lib/deep-research/orchestrator", () => ({
  parsePlanPatchSubQuestions: (raw: string | undefined) => {
    if (!raw) return [];
    return (JSON.parse(raw) as { subQuestions?: string[] }).subQuestions ?? [];
  },
  runDeepResearchTurn: (...args: unknown[]) => runDeepResearchTurn(...args),
}));

vi.mock("../../../../../../lib/deep-research/plan-gate-orphan", () => ({
  orphanGateKind: (...args: unknown[]) => orphanGateKind(...args),
  latestResearchPlanEvent: (...args: unknown[]) => latestResearchPlanEvent(...args),
  snapshotToResearchPlan: (...args: unknown[]) => snapshotToResearchPlan(...args),
  toPlanSnapshot: (...args: unknown[]) => toPlanSnapshot(...args),
}));

vi.mock("../../../../../../lib/deep-research/plan-chat-revise", () => ({
  syncRevisePlanChat: (...args: unknown[]) => syncRevisePlanChat(...args),
}));

vi.mock("../../../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: vi.fn(),
}));

vi.mock("../../../../../../lib/web-search/daily-provider-quota", () => ({
  reserveTenantDailySearchProviderCall: vi.fn(),
}));

vi.mock("../../../../../../lib/deep-research/run-wait", () => ({
  CHAT_CLARIFY_ANSWER_KEY: "__chat__",
  PLAN_GATE_ACTION_KEY: "__plan_action__",
  PLAN_GATE_PATCH_KEY: "__plan_patch__",
  MAX_GATE_ANSWER_CHARS: 2_000,
  MAX_PLAN_PATCH_CHARS: 4_000,
  hasLiveClarifyWaiter: (...args: unknown[]) => hasLiveClarifyWaiter(...args),
  notifyClarifyResume: (...args: unknown[]) => notifyClarifyResume(...args),
}));

import { POST } from "../route";
import {
  resetChatConcurrencyForTests,
  tryAcquireChatTurn,
} from "../../../../../../lib/chat-concurrency";

const SESSION = {
  tenantId: "tenant-1",
  userId: "user-1",
  email: "user@example.com",
  deptId: null,
  sessionId: "auth-session-1",
  mustChangePassword: false,
};

const PLAN_SNAPSHOT = {
  version: 1,
  objective: "研究主题",
  scope: [],
  subQuestions: [{ id: "sq1", title: "现状" }],
  sourceStrategy: [],
  deliverables: [],
  assumptions: [],
};

const PLAN_EVENT = {
  type: "research_plan" as const,
  runId: "run-plan-orphan",
  action: "proposed" as const,
  version: 1,
  plan: PLAN_SNAPSHOT,
};

const PLAN_RUN = {
  runId: "run-plan-orphan",
  traceId: "original-run-trace",
  tenantId: "tenant-1",
  userId: "user-1",
  sessionId: "chat-session-1",
  status: "awaiting_clarify" as const,
  phase: "plan",
  topic: "研究主题",
  events: [PLAN_EVENT],
  reportMarkdown: "",
  citations: [],
  eventSeq: 1,
  revision: 1,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/chat/deep-research/resume", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/chat/deep-research/resume", () => {
  beforeEach(() => {
    resetChatConcurrencyForTests();
    for (const mock of [
      getSessionAuthFromCookies,
      resolveClarification,
      getRun,
      claimPlanGateResume,
      appendEvents,
      beginClarification,
      notifyClarifyResume,
      hasLiveClarifyWaiter,
      orphanGateKind,
      latestResearchPlanEvent,
      snapshotToResearchPlan,
      toPlanSnapshot,
      runDeepResearchTurn,
      syncRevisePlanChat,
    ]) {
      mock.mockReset();
    }
    getSessionAuthFromCookies.mockResolvedValue({
      session: SESSION,
      accessToken: "access-token",
      refreshToken: null,
    });
    getRun.mockResolvedValue(null);
    resolveClarification.mockResolvedValue("resumed");
    hasLiveClarifyWaiter.mockReturnValue(false);
    orphanGateKind.mockReturnValue(null);
    claimPlanGateResume.mockResolvedValue(true);
    appendEvents.mockResolvedValue(undefined);
    beginClarification.mockResolvedValue(true);
    runDeepResearchTurn.mockResolvedValue(new Response(""));
  });

  it("stores the first answer and wakes local waiters", async () => {
    const response = await POST(
      request({ runId: "run-1", answers: { q1: " A " }, skip: false }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { runId: "run-1", resumed: true },
    });
    expect(resolveClarification).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      payload: { answers: { q1: "A" }, skip: false },
    });
    expect(notifyClarifyResume).toHaveBeenCalledWith("run-1");
  });

  it("treats an empty answer set as an explicit skip", async () => {
    await POST(request({ runId: "run-1", answers: {} }));
    expect(resolveClarification).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { answers: {}, skip: true } }),
    );
  });

  it("normalizes conversational and plan-gate replies into persisted answer keys", async () => {
    await POST(
      request({
        runId: "run-1",
        chatReply: "  侧重落地案例  ",
        planAction: "edit",
        planPatch: '{"subQuestions":["案例"]}',
      }),
    );

    expect(resolveClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          answers: {
            __chat__: "侧重落地案例",
            __plan_action__: "edit",
            __plan_patch__: '{"subQuestions":["案例"]}',
          },
          skip: false,
        },
      }),
    );
  });

  it("lets a live plan waiter keep ownership", async () => {
    getRun.mockResolvedValue(PLAN_RUN);
    orphanGateKind.mockReturnValue("plan");
    hasLiveClarifyWaiter.mockReturnValue(true);

    const response = await POST(
      request({ runId: PLAN_RUN.runId, planAction: "approve", model: "provider/model" }),
    );

    expect(response.status).toBe(200);
    expect(claimPlanGateResume).not.toHaveBeenCalled();
    expect(runDeepResearchTurn).not.toHaveBeenCalled();
    expect(notifyClarifyResume).toHaveBeenCalledWith(PLAN_RUN.runId);
  });

  it("does not count a live waiter resume against Portal turn capacity", async () => {
    getRun.mockResolvedValue(PLAN_RUN);
    orphanGateKind.mockReturnValue("plan");
    hasLiveClarifyWaiter.mockReturnValue(true);
    const leases = Array.from({ length: 3 }, () =>
      tryAcquireChatTurn({ tenantId: SESSION.tenantId, userId: SESSION.userId }),
    );

    try {
      const response = await POST(
        request({ runId: PLAN_RUN.runId, planAction: "approve" }),
      );
      expect(response.status).toBe(200);
      expect(resolveClarification).toHaveBeenCalledTimes(1);
      expect(claimPlanGateResume).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.release());
    }
  });

  it("rejects an orphan takeover before clarification writes or claims when full", async () => {
    getRun.mockResolvedValue(PLAN_RUN);
    orphanGateKind.mockReturnValue("plan");
    const leases = Array.from({ length: 3 }, () =>
      tryAcquireChatTurn({ tenantId: SESSION.tenantId, userId: SESSION.userId }),
    );

    try {
      const response = await POST(
        request({ runId: PLAN_RUN.runId, planAction: "approve" }),
      );
      expect(response.status).toBe(429);
      expect(resolveClarification).not.toHaveBeenCalled();
      expect(claimPlanGateResume).not.toHaveBeenCalled();
      expect(appendEvents).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.release());
    }
  });

  it("claims and continues an active orphaned plan gate exactly once", async () => {
    vi.useFakeTimers();
    try {
      getRun.mockResolvedValue(PLAN_RUN);
      orphanGateKind.mockReturnValue("plan");
      latestResearchPlanEvent.mockReturnValue(PLAN_EVENT);
      snapshotToResearchPlan.mockReturnValue({
        topic: "研究主题",
        complexity: "simple",
        subQuestions: ["现状"],
      });
      toPlanSnapshot.mockReturnValue(PLAN_SNAPSHOT);

      const pending = POST(
        request({ runId: PLAN_RUN.runId, planAction: "approve", model: "provider/model" }),
      );
      await vi.advanceTimersByTimeAsync(1_250);
      const response = await pending;

      await expect(response.json()).resolves.toMatchObject({
        data: { runId: PLAN_RUN.runId, resumed: true, orphanContinued: true },
      });
      expect(claimPlanGateResume).toHaveBeenCalledTimes(1);
      expect(appendEvents).toHaveBeenCalledWith(
        PLAN_RUN.runId,
        expect.arrayContaining([
          expect.objectContaining({ type: "research_plan", action: "approved" }),
        ]),
        { status: "running", phase: "plan_resuming" },
      );
      expect(runDeepResearchTurn).toHaveBeenCalledWith(
        expect.objectContaining({ model: "model" }),
        expect.objectContaining({
          runId: PLAN_RUN.runId,
          traceId: PLAN_RUN.traceId,
          headers: expect.objectContaining({
            "x-agenticx-trace-id": PLAN_RUN.traceId,
          }),
          continueFromPlanGate: expect.objectContaining({
            planEventEmitted: true,
            planVersion: 1,
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds orphan capacity until the detached research response reaches EOF", async () => {
    vi.useFakeTimers();
    let backgroundController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const extraLeases: Array<ReturnType<typeof tryAcquireChatTurn>> = [];
    try {
      getRun.mockResolvedValue(PLAN_RUN);
      orphanGateKind.mockReturnValue("plan");
      latestResearchPlanEvent.mockReturnValue(PLAN_EVENT);
      snapshotToResearchPlan.mockReturnValue({
        topic: "研究主题",
        complexity: "simple",
        subQuestions: ["现状"],
      });
      toPlanSnapshot.mockReturnValue(PLAN_SNAPSHOT);
      runDeepResearchTurn.mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              backgroundController = controller;
            },
          }),
        ),
      );

      const pending = POST(
        request({ runId: PLAN_RUN.runId, planAction: "approve", model: "provider/model" }),
      );
      await vi.advanceTimersByTimeAsync(1_250);
      const response = await pending;
      expect(response.status).toBe(200);

      extraLeases.push(
        tryAcquireChatTurn({ tenantId: SESSION.tenantId, userId: SESSION.userId }),
        tryAcquireChatTurn({ tenantId: SESSION.tenantId, userId: SESSION.userId }),
      );
      expect(extraLeases.every(Boolean)).toBe(true);
      expect(
        tryAcquireChatTurn({ tenantId: SESSION.tenantId, userId: SESSION.userId }),
      ).toBeNull();

      backgroundController!.close();
      await vi.advanceTimersByTimeAsync(0);
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
      const afterEof = tryAcquireChatTurn({
        tenantId: SESSION.tenantId,
        userId: SESSION.userId,
      });
      expect(afterEof).not.toBeNull();
      afterEof?.release();
    } finally {
      extraLeases.forEach((lease) => lease?.release());
      vi.useRealTimers();
    }
  });

  it("is idempotent for repeat submissions and timeouts", async () => {
    resolveClarification.mockResolvedValue("already_continued");
    const response = await POST(request({ runId: "run-1", answers: { q1: "A" } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { runId: "run-1", resumed: false, alreadyContinued: true },
    });
    expect(notifyClarifyResume).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown, cross-tenant and cross-user runs", async () => {
    resolveClarification.mockResolvedValue("not_found");
    const response = await POST(request({ runId: "someone-elses-run", answers: { q1: "A" } }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "40401" },
    });
  });

  it("returns 500 rather than faking already-continued when storage fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolveClarification.mockRejectedValue(new Error("db down"));

    const response = await POST(request({ runId: "run-1", answers: { q1: "A" } }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "50000" } });
    expect(notifyClarifyResume).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects unauthenticated callers before touching the store", async () => {
    getSessionAuthFromCookies.mockResolvedValue(null);
    const response = await POST(request({ runId: "run-1" }));
    expect(response.status).toBe(401);
    expect(resolveClarification).not.toHaveBeenCalled();
  });

  it("rejects a missing runId", async () => {
    const response = await POST(request({ answers: { q1: "A" } }));
    expect(response.status).toBe(400);
    expect(resolveClarification).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await POST(request("not json"));
    expect(response.status).toBe(400);
    expect(resolveClarification).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  listActiveSummaries: vi.fn(),
  getLatestBySession: vi.fn(),
  get: vi.fn(),
  reapStaleRuns: vi.fn(),
  finish: vi.fn(),
  listByRun: vi.fn(),
}));

vi.mock("../../../../../lib/session", () => ({ getSessionFromCookies: mocks.session }));
vi.mock("../../../../../lib/deep-research/run-store", () => ({
  defaultRunStore: mocks,
  runLooksFinished: (row: { phase?: string; events?: Array<{ type?: string; phase?: string; kind?: string; path?: string }>; reportMarkdown?: string }) => {
    if (row.phase === "done") return true;
    if ((row.reportMarkdown ?? "").trim().length >= 2_000) return true;
    return false;
  },
}));
vi.mock("../../../../../lib/deep-research/artifact-store", () => ({ defaultArtifactStore: mocks }));
vi.mock("../../../../../lib/observability/with-request-log", () => ({
  withRequestLog: (_name: string, handler: (ctx: unknown) => unknown) =>
    handler({ setUser: vi.fn(), setMode: vi.fn() }),
}));

import { GET } from "./route";

const summary = {
  runId: "run",
  sessionId: "session",
  status: "running",
  phase: "lanes",
  topic: "synthetic",
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

const fullRun = {
  ...summary,
  tenantId: "tenant",
  userId: "user",
  events: [{ type: "phase", phase: "lanes", message: "检索中" }],
  reportMarkdown: "报告正文",
  citations: [],
  eventSeq: 1,
};

describe("GET /api/chat/deep-research/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ tenantId: "tenant", userId: "user" });
    mocks.listActiveSummaries.mockResolvedValue([summary]);
    mocks.get.mockImplementation(async (_tenant: string, _user: string, runId: string) =>
      runId === "run" ? fullRun : null,
    );
    mocks.getLatestBySession.mockResolvedValue(fullRun);
    mocks.reapStaleRuns.mockResolvedValue(0);
    mocks.finish.mockResolvedValue(undefined);
    mocks.listByRun.mockResolvedValue([]);
  });

  it("returns active summaries without events or report text", async () => {
    const response = await GET(
      new Request("http://localhost/api/chat/deep-research/runs?sessionId=session"),
    );
    const { data } = await response.json();
    expect(response.status).toBe(200);
    expect(data.runs).toEqual([
      {
        runId: "run",
        sessionId: "session",
        status: "running",
        phase: "lanes",
        topic: "synthetic",
        updatedAt: summary.updatedAt,
      },
    ]);
    expect(data.runs[0]).not.toHaveProperty("events");
    expect(data.runs[0]).not.toHaveProperty("reportMarkdown");
    expect(mocks.listActiveSummaries).toHaveBeenCalledWith("tenant", "user", "session");
  });

  it("hydrates the requested run instead of the session's latest", async () => {
    mocks.get.mockImplementation(async (_tenant: string, _user: string, runId: string) => {
      if (runId === "older") {
        return {
          ...fullRun,
          runId: "older",
          events: [{ type: "phase", phase: "lanes", message: "旧研究" }],
        };
      }
      return runId === "run" ? fullRun : null;
    });
    const response = await GET(
      new Request(
        "http://localhost/api/chat/deep-research/runs?sessionId=session&hydrate=1&runId=older",
      ),
    );
    const { data } = await response.json();
    expect(data.latest.runId).toBe("older");
    expect(data.latest.events[0].message).toBe("旧研究");
    expect(mocks.get).toHaveBeenCalledWith("tenant", "user", "older");
    expect(mocks.getLatestBySession).not.toHaveBeenCalled();
  });

  it("returns an empty hydrate when the run belongs to another user", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET(
      new Request(
        "http://localhost/api/chat/deep-research/runs?sessionId=session&hydrate=1&runId=other-user-run",
      ),
    );
    const { data } = await response.json();
    expect(response.status).toBe(200);
    expect(data.latest).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith("tenant", "user", "other-user-run");
  });

  it("does not hydrate a run from another chat session", async () => {
    mocks.get.mockResolvedValue({ ...fullRun, runId: "older", sessionId: "other" });
    const response = await GET(
      new Request(
        "http://localhost/api/chat/deep-research/runs?sessionId=session&hydrate=1&runId=older",
      ),
    );
    expect((await response.json()).data.latest).toBeNull();
  });

  it("still closes a running row that already has a stored report", async () => {
    mocks.listByRun.mockResolvedValue([
      { id: "report", path: "research/final-report.md", kind: "report", title: "报告", byteSize: 128 },
    ]);
    const response = await GET(
      new Request("http://localhost/api/chat/deep-research/runs?sessionId=session"),
    );
    const { data } = await response.json();
    expect(mocks.finish).toHaveBeenCalledWith("run", "completed");
    expect(data.runs).toEqual([]);
  });
});

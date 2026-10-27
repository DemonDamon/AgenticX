import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const listMaSchedulesMock = vi.fn();
const createMaScheduleMock = vi.fn();
const getMaScheduleMock = vi.fn();
const updateMaScheduleMock = vi.fn();
const deleteMaScheduleMock = vi.fn();
const requestMaScheduleRunMock = vi.fn();
const listMaScheduleRunsMock = vi.fn();
const getMaScheduleRunSummaryMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", async () => {
  const actual = await vi.importActual<typeof import("@agenticx/iam-core")>("@agenticx/iam-core");
  return {
    ...actual,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    listMaSchedules: (...args: unknown[]) => listMaSchedulesMock(...args),
    createMaSchedule: (...args: unknown[]) => createMaScheduleMock(...args),
    getMaSchedule: (...args: unknown[]) => getMaScheduleMock(...args),
    updateMaSchedule: (...args: unknown[]) => updateMaScheduleMock(...args),
    deleteMaSchedule: (...args: unknown[]) => deleteMaScheduleMock(...args),
    requestMaScheduleRun: (...args: unknown[]) => requestMaScheduleRunMock(...args),
    listMaScheduleRuns: (...args: unknown[]) => listMaScheduleRunsMock(...args),
    getMaScheduleRunSummary: (...args: unknown[]) => getMaScheduleRunSummaryMock(...args),
  };
});

const { POST, GET: list } = await import("../schedules/route");
const { PATCH } = await import("../schedules/[scheduleId]/route");
const { POST: run } = await import("../schedules/[scheduleId]/run/route");
const { GET: runs } = await import("../schedules/[scheduleId]/runs/route");

const SCHEDULE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const AGENT_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";

function authed(url: string, scopes: string[], init?: RequestInit) {
  verifyPatMock.mockResolvedValue({
    id: 7,
    tenantId: "tenant_pat",
    userId: "user_pat",
    deptId: null,
    scopes,
    status: "active",
  });
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer agx-pat-test");
  return new Request(url, { ...init, headers });
}

function schedule(extra: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    tenantId: "tenant_pat",
    name: "日报",
    description: null,
    agentId: AGENT_ID,
    versionPolicy: "follow_routing",
    pinnedVersion: null,
    environmentId: null,
    cron: "0 9 * * 1-5",
    timezone: "Asia/Shanghai",
    inputTemplate: "生成 {{date}} 的日报",
    vaultIds: [],
    resources: [],
    runAsUserId: "user_pat",
    enabled: true,
    revision: 1,
    misfireGraceSeconds: 300,
    manualRunRequestedAt: null,
    createdBy: "user_pat",
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...extra,
  };
}

const body = {
  name: "日报",
  agent_id: AGENT_ID,
  cron: "0 9 * * 1-5",
  input_template: "生成 {{date}} 的日报",
};

describe("public schedule routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    listMaSchedulesMock.mockReset();
    createMaScheduleMock.mockReset();
    getMaScheduleMock.mockReset();
    updateMaScheduleMock.mockReset();
    deleteMaScheduleMock.mockReset();
    requestMaScheduleRunMock.mockReset();
    listMaScheduleRunsMock.mockReset();
    getMaScheduleRunSummaryMock.mockReset();
    getMaScheduleRunSummaryMock.mockResolvedValue(new Map());
  });

  it("rejects a token without the schedule scope", async () => {
    const response = await list(authed("http://localhost/api/ma/v1/schedules", ["ma:agents:read"]));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden_scope");
  });

  it("creates a schedule owned by the PAT user", async () => {
    createMaScheduleMock.mockImplementation(async (_tenant: string, _body: Record<string, unknown>, userId: string) =>
      schedule({ runAsUserId: userId, revision: 1 }),
    );
    const response = await POST(
      authed("http://localhost/api/ma/v1/schedules", ["ma:schedules:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { schedule: Record<string, unknown> };
    expect(payload.schedule.run_as_user_id).toBe("user_pat");
    expect(payload.schedule.revision).toBe(1);
    expect(payload.schedule.next_run_at).toBeNull();
  });

  it("bumps revision when only enabled changes", async () => {
    updateMaScheduleMock.mockResolvedValue(schedule({ enabled: false, revision: 2 }));
    getMaScheduleMock.mockResolvedValue(schedule({ enabled: false, revision: 2 }));
    const response = await PATCH(
      authed(`http://localhost/api/ma/v1/schedules/${SCHEDULE_ID}`, ["ma:schedules:write"], {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ scheduleId: SCHEDULE_ID }) },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { schedule: { revision: number } };
    expect(payload.schedule.revision).toBe(2);
  });

  it("requests a manual run with 202", async () => {
    requestMaScheduleRunMock.mockResolvedValue(schedule());
    const response = await run(
      authed(`http://localhost/api/ma/v1/schedules/${SCHEDULE_ID}/run`, ["ma:schedules:write"], { method: "POST" }),
      { params: Promise.resolve({ scheduleId: SCHEDULE_ID }) },
    );
    expect(response.status).toBe(202);
    expect(requestMaScheduleRunMock).toHaveBeenCalledWith("tenant_pat", SCHEDULE_ID);
  });

  it("returns schedule run records with the frozen keys", async () => {
    listMaScheduleRunsMock.mockResolvedValue([
      {
        id: "01C23456789ABCDEFGHJKMNPQR",
        scheduleId: SCHEDULE_ID,
        scheduleRevision: 1,
        trigger: "schedule",
        scheduledFor: "2026-10-26T01:00:00.000Z",
        status: "succeeded",
        skipReason: null,
        sessionId: "01D23456789ABCDEFGHJKMNPQR",
        agentVersion: 3,
        error: null,
        startedAt: "2026-10-26T01:00:01.000Z",
        finishedAt: "2026-10-26T01:00:08.000Z",
        createdAt: "2026-10-25T00:00:00.000Z",
      },
    ]);
    const response = await runs(authed(`http://localhost/api/ma/v1/schedules/${SCHEDULE_ID}/runs`, ["ma:schedules:read"]), {
      params: Promise.resolve({ scheduleId: SCHEDULE_ID }),
    });
    const payload = (await response.json()) as { data: Array<Record<string, unknown>> };
    expect(Object.keys(payload.data[0] ?? {}).sort()).toEqual(
      [
        "agent_version",
        "created_at",
        "error",
        "finished_at",
        "id",
        "schedule_id",
        "schedule_revision",
        "scheduled_for",
        "session_id",
        "skip_reason",
        "started_at",
        "status",
        "trigger",
      ].sort(),
    );
  });

  it("maps the 101st schedule to schedule_limit and a missing id to 404", async () => {
    const { MaScheduleLimitError, MaScheduleNotFoundError } = await import("@agenticx/iam-core");
    let count = 0;
    createMaScheduleMock.mockImplementation(async () => {
      count += 1;
      if (count > 100) throw new MaScheduleLimitError();
      return schedule();
    });
    for (let index = 0; index < 100; index += 1) {
      const ok = await POST(
        authed("http://localhost/api/ma/v1/schedules", ["ma:schedules:write"], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(ok.status).toBe(201);
    }
    const limited = await POST(
      authed("http://localhost/api/ma/v1/schedules", ["ma:schedules:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(limited.status).toBe(409);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("schedule_limit");

    listMaScheduleRunsMock.mockRejectedValue(new MaScheduleNotFoundError());
    const missing = await runs(authed(`http://localhost/api/ma/v1/schedules/${SCHEDULE_ID}/runs`, ["ma:schedules:read"]), {
      params: Promise.resolve({ scheduleId: SCHEDULE_ID }),
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("schedule_not_found");
  });
});

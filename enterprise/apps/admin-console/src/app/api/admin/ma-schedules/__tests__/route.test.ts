import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listMaSchedulesMock = vi.fn();
const getMaScheduleRunSummaryMock = vi.fn();
const deleteMaScheduleMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("@agenticx/iam-core", () => ({
  listMaSchedules: (...args: unknown[]) => listMaSchedulesMock(...args),
  getMaScheduleRunSummary: (...args: unknown[]) => getMaScheduleRunSummaryMock(...args),
  deleteMaSchedule: (...args: unknown[]) => deleteMaScheduleMock(...args),
  createMaSchedule: vi.fn(),
}));

const { GET } = await import("../route");
const { DELETE } = await import("../[scheduleId]/route");

const SCHEDULE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("admin ma-schedules routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listMaSchedulesMock.mockReset();
    getMaScheduleRunSummaryMock.mockReset();
    deleteMaScheduleMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("returns 403 without provider:read", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const response = await GET(new Request("http://localhost/api/admin/ma-schedules"));
    expect(response.status).toBe(403);
  });

  it("includes next_run_at and last_run on each list item", async () => {
    listMaSchedulesMock.mockResolvedValue([
      {
        id: SCHEDULE_ID,
        tenantId: "tenant_test",
        name: "日报",
        description: null,
        agentId: "01BX5ZZKBKACTAV9WEVGEMMVSX",
        versionPolicy: "follow_routing",
        pinnedVersion: null,
        environmentId: null,
        cron: "0 9 * * 1-5",
        timezone: "Asia/Shanghai",
        inputTemplate: "hi",
        vaultIds: [],
        resources: [],
        runAsUserId: "user_1",
        enabled: true,
        revision: 1,
        misfireGraceSeconds: 300,
        manualRunRequestedAt: null,
        createdBy: "user_1",
        createdAt: "2026-10-25T00:00:00.000Z",
        updatedAt: "2026-10-25T00:00:00.000Z",
      },
    ]);
    getMaScheduleRunSummaryMock.mockResolvedValue(
      new Map([
        [
          SCHEDULE_ID,
          {
            nextRunAt: "2026-10-26T01:00:00.000Z",
            lastRun: {
              id: "01C23456789ABCDEFGHJKMNPQR",
              scheduleId: SCHEDULE_ID,
              scheduleRevision: 1,
              trigger: "schedule",
              scheduledFor: "2026-10-25T01:00:00.000Z",
              status: "succeeded",
              skipReason: null,
              sessionId: "01D23456789ABCDEFGHJKMNPQR",
              agentVersion: 1,
              error: null,
              startedAt: null,
              finishedAt: null,
              createdAt: "2026-10-25T00:00:00.000Z",
            },
          },
        ],
      ]),
    );
    const response = await GET(new Request("http://localhost/api/admin/ma-schedules"));
    const body = (await response.json()) as { code: string; data: { schedules: Array<Record<string, unknown>> } };
    expect(body.code).toBe("00000");
    expect(body.data.schedules[0]).toHaveProperty("next_run_at", "2026-10-26T01:00:00.000Z");
    expect(body.data.schedules[0]?.last_run).toMatchObject({ id: "01C23456789ABCDEFGHJKMNPQR", status: "succeeded" });
  });

  it("requires provider:delete to delete a schedule", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const denied = await DELETE(new Request("http://localhost/api/admin/ma-schedules/" + SCHEDULE_ID, { method: "DELETE" }), {
      params: Promise.resolve({ scheduleId: SCHEDULE_ID }),
    });
    expect(denied.status).toBe(403);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["provider:delete"]);
    deleteMaScheduleMock.mockResolvedValue(undefined);
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
    const allowed = await DELETE(new Request("http://localhost/api/admin/ma-schedules/" + SCHEDULE_ID, { method: "DELETE" }), {
      params: Promise.resolve({ scheduleId: SCHEDULE_ID }),
    });
    expect(allowed.status).toBe(200);
    expect(deleteMaScheduleMock).toHaveBeenCalledWith("tenant_test", SCHEDULE_ID);
  });
});

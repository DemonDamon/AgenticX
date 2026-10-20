import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), trend: vi.fn() }));
vi.mock("../../../../lib/admin-auth", () => ({ requireAdminScope: mocks.auth }));
vi.mock("../../../../lib/feature-usage-report", () => ({ readFeatureUsageTrend: mocks.trend }));

import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost/api/metering/feature-usage", {
  method: "POST",
  body: JSON.stringify(body),
});

describe("feature usage report", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, session: { tenantId: "authenticated-tenant" } });
    mocks.trend.mockResolvedValue({ points: [], totals: {} });
  });

  it("reads the authenticated tenant even when the payload names another", async () => {
    const response = await POST(request({
      tenantId: "other-tenant",
      start: "2026-09-01",
      end: "2026-09-21",
      dept_id: ["d-1"],
      user_id: "u-1",
    }));
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(["metering:read"]);
    expect(mocks.trend).toHaveBeenCalledWith({
      tenantId: "authenticated-tenant",
      fromDay: "2026-09-01",
      toDay: "2026-09-21",
      deptIds: ["d-1"],
      userIds: ["u-1"],
    });
  });

  it.each([null, [], "bad body"])("rejects malformed bodies without querying usage: %s", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.trend).not.toHaveBeenCalled();
  });

  it("rejects a non-string user filter", async () => {
    expect((await POST(request({ user_id: 12 }))).status).toBe(400);
    expect(mocks.trend).not.toHaveBeenCalled();
  });
});

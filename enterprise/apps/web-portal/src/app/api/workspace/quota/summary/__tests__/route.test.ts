import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
}));

vi.mock("@agenticx/iam-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenticx/iam-core")>();
  return {
    ...actual,
    getQuotaSummaryForSession: vi.fn(),
  };
});

import { getQuotaSummaryForSession } from "@agenticx/iam-core";
import { GET } from "../route";
import { getSessionFromCookies } from "../../../../../../lib/session";

describe("GET /api/workspace/quota/summary", () => {
  it("returns 401 without session", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/workspace/quota/summary?userId=evil"));
    expect(res.status).toBe(401);
  });

  it("ignores query overrides and uses session identity (AC-3)", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce({
      userId: "u-a",
      tenantId: "tenant-1",
      email: "a@example.com",
      scopes: [],
      deptId: "dept-a",
      sessionId: "sess-1",
    });
    vi.mocked(getQuotaSummaryForSession).mockResolvedValueOnce({
      daily: {
        scope: "user",
        scopeId: "u-a",
        period: "2026-06-07",
        used: 0,
        limit: 0,
        remaining: null,
        unlimited: true,
      },
      weekly: {
        scope: "user",
        scopeId: "u-a",
        period: "2026-W23",
        used: 0,
        limit: 0,
        remaining: null,
        unlimited: true,
      },
      monthly: {
        scope: "user",
        scopeId: "u-a",
        period: "2026-06",
        used: 1,
        limit: 100,
        remaining: 99,
        unlimited: false,
      },
      user: {
        scope: "user",
        scopeId: "u-a",
        period: "2026-06",
        used: 1,
        limit: 100,
        remaining: 99,
        unlimited: false,
      },
      dept: null,
      unlimited: false,
    });
    const res = await GET(
      new Request("http://localhost/api/workspace/quota/summary?userId=other-user&deptId=other-dept"),
    );
    expect(res.status).toBe(200);
    expect(getQuotaSummaryForSession).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "u-a",
      deptId: "dept-a",
    });
    const body = await res.json();
    expect(body?.data?.daily).toBeTruthy();
    expect(body?.data?.weekly).toBeTruthy();
    expect(body?.data?.monthly).toBeTruthy();
    expect(body?.data?.user).toBeTruthy();
  });
});

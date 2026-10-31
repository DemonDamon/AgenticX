import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

describe("admin data-suite nl2sql", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "admin@agenticx.local", userId: "u1", tenantId: "t1" },
    });
    delete process.env.AGX_NL2SQL_BACKEND;
  });

  it("explain returns SQL draft without rows", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/data-suite/nl2sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "上月华东大区 GMV 和退货率分别是多少？",
          mode: "explain",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      code: string;
      data: { mode: string; executed: boolean; rows: unknown[]; sql: string; refused: boolean };
    };
    expect(body.code).toBe("00000");
    expect(body.data.mode).toBe("explain");
    expect(body.data.executed).toBe(false);
    expect(body.data.rows).toEqual([]);
    expect(body.data.sql.toUpperCase()).toContain("SELECT");
    expect(body.data.refused).toBe(false);
  });

  it("execute denies write SQL with Chinese denial_zh", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/data-suite/nl2sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "写入一行",
          mode: "execute",
          sql: "DELETE FROM retail_monthly",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { refused: boolean; code: string; denial_zh: string; executed: boolean };
    };
    expect(body.data.refused).toBe(true);
    expect(body.data.code).toBe("write_guard_denied");
    expect(body.data.executed).toBe(false);
    expect(body.data.denial_zh).toContain("写闸已拒绝");
  });

  it("returns 401/403 from session scope gate", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/data-suite/nl2sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "q", mode: "explain" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

describe("admin data-suite query ACL", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "admin@agenticx.local", userId: "u1", tenantId: "t1" },
    });
  });

  it("returns 403 when data role is outsider", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/data-suite/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "outsider", dataset_id: "members" }),
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string; message: string; reason: string };
    expect(body.code).toBe("40310");
    expect(body.message).toBe("数据权限不足");
    expect(body.reason).toContain("role_not_granted");
  });

  it("returns masked rows for analyst", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/data-suite/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "analyst",
          dataset_id: "members",
          board_id: "sample_member_board",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      code: string;
      data: { rows: Array<Record<string, string | null>>; masked: boolean };
    };
    expect(body.code).toBe("00000");
    expect(body.data.masked).toBe(true);
    expect(body.data.rows[0]?.phone).toBe("1*********8");
  });

  it("returns 401/403 from session scope gate", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/data-suite/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "analyst", dataset_id: "members" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

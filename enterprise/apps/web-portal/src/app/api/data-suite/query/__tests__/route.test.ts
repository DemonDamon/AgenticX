import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
}));

describe("portal data-suite query ACL", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset();
    getSessionFromCookies.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      email: "user@agenticx.local",
      scopes: [],
      sessionId: "s1",
      mustChangePassword: false,
    });
  });

  it("returns 401 without session", async () => {
    getSessionFromCookies.mockResolvedValueOnce(null);
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/data-suite/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "analyst", dataset_id: "members" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for outsider data role", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/data-suite/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "outsider", dataset_id: "members" }),
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("40310");
    expect(body.message).toBe("数据权限不足");
  });

  it("returns masked rows for analyst", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/data-suite/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "analyst", dataset_id: "members" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { rows: Array<Record<string, string | null>>; masked: boolean };
    };
    expect(body.data.masked).toBe(true);
    expect(body.data.rows[0]?.phone).toBe("1*********8");
  });
});

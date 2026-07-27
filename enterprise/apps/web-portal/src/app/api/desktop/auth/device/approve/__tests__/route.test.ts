import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const approveDesktopDeviceForSession = vi.fn();

vi.mock("../../../../../../../lib/session", () => ({
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
}));

vi.mock("../../../../../../../lib/desktop-device-auth", () => ({
  approveDesktopDeviceForSession: (...args: unknown[]) => approveDesktopDeviceForSession(...args),
}));

describe("POST /api/desktop/auth/device/approve", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset();
    approveDesktopDeviceForSession.mockReset();
  });

  it("returns 401 without session", async () => {
    getSessionFromCookies.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(approveDesktopDeviceForSession).not.toHaveBeenCalled();
  });

  it("returns 403 on tenant mismatch", async () => {
    getSessionFromCookies.mockResolvedValue({
      tenantId: "t1",
      userId: "u1",
      deptId: "d1",
    });
    approveDesktopDeviceForSession.mockRejectedValue(
      Object.assign(new Error("tenant mismatch"), { code: "40301" }),
    );
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("approves with session identity and never returns PAT", async () => {
    getSessionFromCookies.mockResolvedValue({
      tenantId: "t1",
      userId: "u1",
      deptId: "d1",
    });
    approveDesktopDeviceForSession.mockResolvedValue({ status: "approved" });
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).not.toHaveProperty("data.token");
    expect(JSON.stringify(json)).not.toContain("agx-pat-");
    expect(approveDesktopDeviceForSession).toHaveBeenCalledWith({
      deviceId: "dev-1",
      tenantId: "t1",
      userId: "u1",
      deptId: "d1",
    });
  });
});

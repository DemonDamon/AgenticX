import { beforeEach, describe, expect, it, vi } from "vitest";

const pollDesktopDeviceAuth = vi.fn();

vi.mock("../../../../../../../lib/desktop-device-auth", () => ({
  pollDesktopDeviceAuth: (...args: unknown[]) => pollDesktopDeviceAuth(...args),
}));

vi.mock("../../../../../../../lib/desktop-device-rate-limit", () => ({
  takeToken: () => true,
  clientIpFromRequest: () => "127.0.0.1",
}));

describe("POST /api/desktop/auth/device/poll", () => {
  beforeEach(() => {
    pollDesktopDeviceAuth.mockReset();
  });

  it("returns pending while waiting", async () => {
    pollDesktopDeviceAuth.mockResolvedValue({ status: "pending" });
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1", deviceSecret: "sec" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { status: "pending" } });
  });

  it("returns completed once with managed PAT payload", async () => {
    pollDesktopDeviceAuth.mockResolvedValue({
      status: "completed",
      token: "agx-pat-testtoken",
      tokenId: 9,
      user: {
        userId: "u1",
        email: "a@example.invalid",
        displayName: "A",
        tenantId: "t1",
        deptId: "d1",
      },
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1", deviceSecret: "sec" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe("completed");
    expect(json.data.token).toBe("agx-pat-testtoken");
  });

  it("returns 410 on consumed replay", async () => {
    pollDesktopDeviceAuth.mockResolvedValue({ status: "consumed" });
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1", deviceSecret: "sec" }),
      }),
    );
    expect(res.status).toBe(410);
  });

  it("returns 401 for invalid secret", async () => {
    pollDesktopDeviceAuth.mockRejectedValue(
      Object.assign(new Error("invalid"), { code: "40101" }),
    );
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1", deviceSecret: "bad" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

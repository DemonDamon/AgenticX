import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelDesktopDeviceAuthRequest = vi.fn();

vi.mock("../../../../../../../lib/desktop-device-auth", () => ({
  cancelDesktopDeviceAuthRequest: (...args: unknown[]) => cancelDesktopDeviceAuthRequest(...args),
}));

describe("POST /api/desktop/auth/device/cancel", () => {
  beforeEach(() => {
    cancelDesktopDeviceAuthRequest.mockReset();
  });

  it("cancels pending authorization", async () => {
    cancelDesktopDeviceAuthRequest.mockResolvedValue(undefined);
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1", deviceSecret: "sec" }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 401 for bad secret", async () => {
    cancelDesktopDeviceAuthRequest.mockRejectedValue(
      Object.assign(new Error("invalid"), { code: "40101" }),
    );
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/device/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-1", deviceSecret: "bad" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

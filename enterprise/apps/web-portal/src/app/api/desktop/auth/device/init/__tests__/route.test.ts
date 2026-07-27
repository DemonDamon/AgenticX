import { beforeEach, describe, expect, it, vi } from "vitest";

const startDesktopDeviceAuth = vi.fn();

vi.mock("../../../../../../../lib/desktop-device-auth", async () => {
  const actual = await vi.importActual<typeof import("../../../../../../../lib/desktop-device-auth")>(
    "../../../../../../../lib/desktop-device-auth",
  );
  return {
    ...actual,
    startDesktopDeviceAuth: (...args: unknown[]) => startDesktopDeviceAuth(...args),
    buildDesktopVerificationUrl: (origin: string, deviceId: string) =>
      `${origin}/auth/desktop?device=${deviceId}`,
  };
});

vi.mock("../../../../../../../lib/desktop-device-rate-limit", () => ({
  takeToken: () => true,
  clientIpFromRequest: () => "127.0.0.1",
}));

describe("POST /api/desktop/auth/device/init", () => {
  beforeEach(() => {
    startDesktopDeviceAuth.mockReset();
  });

  it("returns device credentials and same-origin verification URL", async () => {
    startDesktopDeviceAuth.mockResolvedValue({
      deviceId: "dev-1",
      deviceSecret: "secret-1",
      expiresIn: 600,
      pollIntervalMs: 2500,
    });
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/desktop/auth/device/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceName: "Near" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deviceId).toBe("dev-1");
    expect(json.data.deviceSecret).toBe("secret-1");
    expect(json.data.verificationUrl).toBe("http://localhost:3000/auth/desktop?device=dev-1");
    expect(json.data.pollIntervalMs).toBe(2500);
  });

  it("preserves 127.0.0.1 from Host header in verificationUrl", async () => {
    startDesktopDeviceAuth.mockResolvedValue({
      deviceId: "dev-2",
      deviceSecret: "secret-2",
      expiresIn: 600,
      pollIntervalMs: 2500,
    });
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/desktop/auth/device/init", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:3000",
        },
        body: JSON.stringify({ deviceName: "Near" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.verificationUrl).toBe(
      "http://127.0.0.1:3000/auth/desktop?device=dev-2",
    );
  });
});

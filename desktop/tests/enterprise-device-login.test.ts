import { describe, expect, it, vi } from "vitest";
import {
  cancelEnterpriseDeviceAuth,
  pollEnterpriseDeviceAuth,
  startEnterpriseDeviceAuth,
} from "../electron/enterprise-device-login";

const BASE = { baseUrl: "http://127.0.0.1:3000" };
const DEVICE = { deviceId: "dev-1", deviceSecret: "sec-1" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function startPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      deviceId: "dev-1",
      deviceSecret: "sec-1",
      verificationUrl: "http://127.0.0.1:3000/auth/desktop?device=abc",
      expiresIn: 600,
      pollIntervalMs: 2500,
      ...overrides,
    },
  };
}

describe("enterprise-device-login", () => {
  it("startEnterpriseDeviceAuth posts the device name to the portal", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const result = await startEnterpriseDeviceAuth(
      {
        ...BASE,
        fetchImpl: async (u, i) => {
          url = u;
          init = i;
          return jsonResponse(startPayload());
        },
      },
      "mac-1",
    );
    expect(result.ok).toBe(true);
    expect(url.endsWith("/api/desktop/auth/device/init")).toBe(true);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({ deviceName: "mac-1" });
  });

  it("startEnterpriseDeviceAuth returns the portal verification url as-is", async () => {
    const result = await startEnterpriseDeviceAuth(
      { ...BASE, fetchImpl: async () => jsonResponse(startPayload()) },
      "mac-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.verificationUrl).toBe("http://127.0.0.1:3000/auth/desktop?device=abc");
  });

  it("startEnterpriseDeviceAuth rejects an empty portal url", async () => {
    const fetchImpl = vi.fn();
    const result = await startEnterpriseDeviceAuth({ baseUrl: "   ", fetchImpl }, "mac-1");
    expect(result).toEqual({ ok: false, error: "请先填写企业门户地址" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("startEnterpriseDeviceAuth maps 404 to a wrong-portal message", async () => {
    const result = await startEnterpriseDeviceAuth(
      { ...BASE, fetchImpl: async () => new Response("not found", { status: 404 }) },
      "mac-1",
    );
    expect(result).toEqual({ ok: false, error: "该地址不是可用的企业门户" });
  });

  it("pollEnterpriseDeviceAuth posts deviceId and deviceSecret", async () => {
    let url = "";
    let init: RequestInit | undefined;
    await pollEnterpriseDeviceAuth(
      {
        ...BASE,
        fetchImpl: async (u, i) => {
          url = u;
          init = i;
          return jsonResponse({ data: { status: "pending" } });
        },
      },
      DEVICE,
    );
    expect(url.endsWith("/api/desktop/auth/device/poll")).toBe(true);
    expect(init?.method).toBe("POST");
    expect(Object.keys(JSON.parse(String(init?.body ?? "{}"))).sort()).toEqual([
      "deviceId",
      "deviceSecret",
    ]);
  });

  it("pollEnterpriseDeviceAuth maps pending", async () => {
    const result = await pollEnterpriseDeviceAuth(
      { ...BASE, fetchImpl: async () => jsonResponse({ data: { status: "pending" } }) },
      DEVICE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("pending");
  });

  it("pollEnterpriseDeviceAuth maps completed with token and user", async () => {
    const result = await pollEnterpriseDeviceAuth(
      {
        ...BASE,
        fetchImpl: async () =>
          jsonResponse({
            data: {
              status: "completed",
              token: "agx-pat-x",
              tokenId: 42,
              user: {
                userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
                email: "a@example.com",
                displayName: "Bob",
                tenantId: "01TENANT0AAAAAAAAAAAAAAA",
                deptId: null,
              },
              expiresAt: "2026-11-28T00:00:00.000Z",
            },
          }),
      },
      DEVICE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "completed") throw new Error("expected completed");
    expect(result.data.token).toBe("agx-pat-x");
    expect(result.data.user.email).toBe("a@example.com");
  });

  it("pollEnterpriseDeviceAuth treats 429 as pending", async () => {
    const result = await pollEnterpriseDeviceAuth(
      { ...BASE, fetchImpl: async () => new Response("slow down", { status: 429 }) },
      DEVICE,
    );
    expect(result).toEqual({ ok: true, data: { status: "pending" } });
  });

  it("pollEnterpriseDeviceAuth maps 410 to gone", async () => {
    const result = await pollEnterpriseDeviceAuth(
      { ...BASE, fetchImpl: async () => new Response("gone", { status: 410 }) },
      DEVICE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "gone") throw new Error("expected gone");
    expect(result.data.error).toContain("重新发起登录");
  });

  it("error messages never leak the portal url or token", async () => {
    const secretBase = { baseUrl: "https://secret.example.com" };
    for (const status of [404, 429, 500, 502]) {
      const started = await startEnterpriseDeviceAuth(
        {
          ...secretBase,
          fetchImpl: async () =>
            new Response("https://secret.example.com agx-pat-secret", { status }),
        },
        "mac-1",
      );
      expect(started.ok).toBe(false);
      if (started.ok) continue;
      expect(started.error.toLowerCase()).not.toContain("http");
      expect(started.error).not.toContain("agx-pat");
    }

    const polled = await pollEnterpriseDeviceAuth(
      {
        ...secretBase,
        fetchImpl: async () => new Response("https://secret.example.com agx-pat-secret", { status: 500 }),
      },
      DEVICE,
    );
    expect(polled.ok).toBe(false);
    if (polled.ok) return;
    expect(polled.error.toLowerCase()).not.toContain("http");
    expect(polled.error).not.toContain("agx-pat");
  });

  it("cancelEnterpriseDeviceAuth swallows transport failures", async () => {
    await expect(
      cancelEnterpriseDeviceAuth(
        {
          ...BASE,
          fetchImpl: async () => {
            throw new Error("socket hang up");
          },
        },
        DEVICE,
      ),
    ).resolves.toBeUndefined();
  });
});

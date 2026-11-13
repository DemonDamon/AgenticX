import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGatewayInternalAuthorized: vi.fn(),
  buildSessionRevocationSnapshotForGateway: vi.fn(),
}));

vi.mock("../../../../../lib/gateway-internal-auth", () => ({
  isGatewayInternalAuthorized: (...args: unknown[]) => mocks.isGatewayInternalAuthorized(...args),
  gatewayInternalUnauthorized: () => Response.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
}));

vi.mock("@agenticx/iam-core", () => ({
  buildSessionRevocationSnapshotForGateway: (...args: unknown[]) =>
    mocks.buildSessionRevocationSnapshotForGateway(...args),
}));

describe("internal session revocation snapshot", () => {
  beforeEach(() => {
    mocks.isGatewayInternalAuthorized.mockReset();
    mocks.buildSessionRevocationSnapshotForGateway.mockReset();
    mocks.isGatewayInternalAuthorized.mockReturnValue(true);
    mocks.buildSessionRevocationSnapshotForGateway.mockImplementation(async () => ({
      version: 3,
      revokedSessionIds: ["sess-1", "sess-2"],
      updatedAt: "2026-11-13T00:00:00.000Z",
    }));
  });

  it("授权网关返回吊销快照且禁缓存", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/session-revocation-snapshot"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      version: 3,
      revokedSessionIds: ["sess-1", "sess-2"],
      updatedAt: "2026-11-13T00:00:00.000Z",
    });
    expect(mocks.buildSessionRevocationSnapshotForGateway).toHaveBeenCalledTimes(1);
  });

  it("未授权调用 401 且不读快照", async () => {
    mocks.isGatewayInternalAuthorized.mockReturnValue(false);
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/session-revocation-snapshot"),
    );

    expect(response.status).toBe(401);
    expect(mocks.buildSessionRevocationSnapshotForGateway).not.toHaveBeenCalled();
  });

  it("快照构建失败 500", async () => {
    mocks.buildSessionRevocationSnapshotForGateway.mockImplementation(async () => {
      throw new Error("db down");
    });
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/session-revocation-snapshot"),
    );

    expect(response.status).toBe(500);
    const json = (await response.json()) as { error?: string; message?: string };
    expect(json.error).toBe("session_revocation_snapshot_failed");
    expect(json.message).toBe("db down");
  });
});

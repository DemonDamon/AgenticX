import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  listGatewayInstances: vi.fn(),
  buildPolicySnapshotBundleForGateway: vi.fn(),
}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../lib/gateway-instances-store", () => ({
  listGatewayInstances: (...args: unknown[]) => mocks.listGatewayInstances(...args),
}));

vi.mock("@agenticx/feature-policy", () => ({
  buildPolicySnapshotBundleForGateway: (...args: unknown[]) => mocks.buildPolicySnapshotBundleForGateway(...args),
}));

describe("admin gateway instances", () => {
  beforeEach(() => {
    mocks.requireAdminScope.mockReset();
    mocks.listGatewayInstances.mockReset();
    mocks.buildPolicySnapshotBundleForGateway.mockReset();
  });

  it("returns 401 and does not read replicas when the session is missing", async () => {
    mocks.requireAdminScope.mockResolvedValue({
      ok: false,
      response: Response.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
    });
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.listGatewayInstances).not.toHaveBeenCalled();
    expect(mocks.buildPolicySnapshotBundleForGateway).not.toHaveBeenCalled();
  });

  it("marks a replica pending when its policy version differs from published ids sorted by tenant", async () => {
    mocks.requireAdminScope.mockResolvedValue({ ok: true, session: { email: "a@example.com", userId: "u", tenantId: "t" } });
    mocks.buildPolicySnapshotBundleForGateway.mockResolvedValue({
      updatedAt: "2026-11-09T00:00:00.000Z",
      tenants: {
        "t-b": { tenantId: "t-b", publishId: "pub-b" },
        "t-a": { tenantId: "t-a", publishId: "pub-a" },
      },
    });
    mocks.listGatewayInstances.mockResolvedValue([
      {
        instanceId: "gw-1",
        tenantScope: "",
        lastSeenAt: new Date(),
        updatedAt: new Date(),
        statusJson: {
          instanceId: "gw-1",
          startedAt: "2026-11-09T00:00:00.000Z",
          domains: [
            { domain: "providers", appliedAt: "", version: "", lastError: "", contentHash: "", checkedAt: "", consecutiveFailures: 0 },
            { domain: "channels", appliedAt: "", version: "", lastError: "", contentHash: "", checkedAt: "", consecutiveFailures: 0 },
            {
              domain: "policy",
              appliedAt: "2026-11-09T00:00:00.000Z",
              version: "pub-old",
              lastError: "",
              contentHash: "abc",
              checkedAt: "",
              consecutiveFailures: 0,
              source: "file:///hidden/snapshot",
            },
            { domain: "mcp_servers", appliedAt: "", version: "", lastError: "", contentHash: "", checkedAt: "", consecutiveFailures: 0 },
          ],
        },
      },
    ]);

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.publishedPolicyVersion).toBe("pub-a,pub-b");
    expect(body.data.instances[0].status).toBe("pending");
    expect(JSON.stringify(body)).not.toContain("source");
    expect(JSON.stringify(body)).not.toContain("file://");
  });
});

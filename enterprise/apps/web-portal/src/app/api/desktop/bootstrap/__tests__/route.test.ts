import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const listAvailableModelsForUser = vi.fn();
const loadDesktopManagedPolicy = vi.fn();
const listAvailableCapabilitiesForUser = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: (...args: unknown[]) => listAvailableModelsForUser(...args),
}));

vi.mock("../../../../../lib/desktop-token-policy", () => ({
  loadDesktopManagedPolicy: (...args: unknown[]) => loadDesktopManagedPolicy(...args),
}));

vi.mock("../../../../../lib/capability-packs-reader", () => ({
  listAvailableCapabilitiesForUser: (...args: unknown[]) =>
    listAvailableCapabilitiesForUser(...args),
}));

describe("GET /api/desktop/bootstrap", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    listAvailableModelsForUser.mockReset().mockResolvedValue([{ id: "local/demo" }]);
    loadDesktopManagedPolicy.mockReset().mockResolvedValue({
      tokenLimits: {
        warningTokensPerSession: 500_000,
        maxTokensPerSession: 1_000_000,
      },
      capabilities: {
        allowLocalSkillInstall: true,
        allowLocalMcpInstall: true,
        allowMcpAutoDiscovery: true,
      },
    });
    listAvailableCapabilitiesForUser.mockReset().mockResolvedValue([]);
  });

  it("returns 401 without a valid PAT", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/desktop/bootstrap"));
    expect(res.status).toBe(401);
    expect(listAvailableModelsForUser).not.toHaveBeenCalled();
  });

  it("returns user, models, and empty capabilities for a valid PAT", async () => {
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: "d1",
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat", "desktop:managed"],
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/desktop/bootstrap"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.user).toMatchObject({ userId: "u1", tenantId: "t1", email: "a@example.invalid" });
    expect(json.data.models).toEqual([{ id: "local/demo" }]);
    expect(json.data.capabilities).toEqual([]);
    expect(json.data.policy.tokenBudget).toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(listAvailableCapabilitiesForUser).toHaveBeenCalledWith(
      "u1",
      "a@example.invalid",
      "d1",
      "desktop",
    );
  });

  it("returns empty capabilities when the pack tables are not migrated yet", async () => {
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: "d1",
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat"],
    });
    listAvailableCapabilitiesForUser.mockRejectedValue(
      new Error('relation "enterprise_capability_packs" does not exist'),
    );

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/desktop/bootstrap"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.capabilities).toEqual([]);
    expect(json.data.models).toEqual([{ id: "local/demo" }]);
  });

  it("does not hide a real capability lookup failure behind an empty list", async () => {
    resolveDesktopIdentity.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      deptId: null,
      email: "a@example.invalid",
      displayName: "A",
      tokenId: 1,
      scopes: ["workspace:chat"],
    });
    listAvailableCapabilitiesForUser.mockRejectedValue(new Error("connection refused"));

    const { GET } = await import("../route");
    await expect(GET(new Request("http://localhost/api/desktop/bootstrap"))).rejects.toThrow(
      /connection refused/,
    );
  });
});

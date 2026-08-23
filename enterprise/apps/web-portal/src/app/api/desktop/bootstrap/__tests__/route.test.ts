import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const listAvailableModelsForUser = vi.fn();
const loadDesktopManagedPolicy = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: (...args: unknown[]) => listAvailableModelsForUser(...args),
}));

vi.mock("../../../../../lib/desktop-token-policy", () => ({
  loadDesktopManagedPolicy: (...args: unknown[]) => loadDesktopManagedPolicy(...args),
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
  });
});

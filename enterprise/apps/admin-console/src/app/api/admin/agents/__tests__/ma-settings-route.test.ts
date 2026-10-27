import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const getAgentWithMaMock = vi.fn();
const updateAgentMaSettingsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../lib/capability-packs-store", () => ({
  assertCapabilityIds: (ids: readonly string[]) => [...ids],
  normalizeAssignmentKeys: (keys: readonly string[]) => [...keys],
}));
vi.mock("@agenticx/iam-core", () => {
  class AgentValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AgentValidationError";
    }
  }
  return {
    AgentValidationError,
    AgentNotFoundError: AgentValidationError,
    AgentSlugConflictError: AgentValidationError,
    validateAgentInput() {},
    getAgentWithMa: (...args: unknown[]) => getAgentWithMaMock(...args),
    updateAgentMaSettings: (...args: unknown[]) => updateAgentMaSettingsMock(...args),
  };
});

const { PATCH } = await import("../[agentId]/ma-settings/route");

function patch(body: unknown) {
  return new Request("http://localhost/api/admin/agents/a1/ma-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin agent ma-settings route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    getAgentWithMaMock.mockReset();
    updateAgentMaSettingsMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
    updateAgentMaSettingsMock.mockResolvedValue({ id: "a1" });
  });

  it("PATCH forwards routing and environment to updateAgentMaSettings", async () => {
    const response = await PATCH(
      patch({ versionRouting: "pinned", pinnedVersion: 2, defaultEnvironmentId: "env_1" }),
      { params: Promise.resolve({ agentId: "a1" }) },
    );
    expect(response.status).toBe(200);
    expect(updateAgentMaSettingsMock).toHaveBeenCalledWith("tenant_test", "a1", {
      versionRouting: "pinned",
      pinnedVersion: 2,
      defaultEnvironmentId: "env_1",
    });
  });

  it("PATCH rejects unknown keys", async () => {
    const response = await PATCH(patch({ foo: 1 }), { params: Promise.resolve({ agentId: "a1" }) });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("不支持的字段：foo");
    expect(updateAgentMaSettingsMock).not.toHaveBeenCalled();
  });

  it("PATCH maps AgentValidationError to 400", async () => {
    const { AgentValidationError } = await import("@agenticx/iam-core");
    updateAgentMaSettingsMock.mockRejectedValue(new AgentValidationError("请选择要固定的版本"));
    const response = await PATCH(patch({ versionRouting: "pinned", pinnedVersion: 1 }), {
      params: Promise.resolve({ agentId: "a1" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("40000");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listMaEnvironmentsMock = vi.fn();
const countMaEnvironmentReferencesMock = vi.fn();
const createMaEnvironmentMock = vi.fn();
const updateMaEnvironmentMock = vi.fn();
const deleteMaEnvironmentMock = vi.fn();
const getMaEnvironmentMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../lib/capability-packs-store", () => ({
  assertCapabilityIds: (ids: readonly string[]) => [...ids],
  normalizeAssignmentKeys: (keys: readonly string[]) => [...keys],
}));
vi.mock("@agenticx/iam-core", () => {
  class MaEnvironmentValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MaEnvironmentValidationError";
    }
  }
  class MaEnvironmentNotFoundError extends Error {
    constructor(message = "环境不存在") {
      super(message);
      this.name = "MaEnvironmentNotFoundError";
    }
  }
  class MaEnvironmentNameConflictError extends Error {
    constructor(message = "环境名称已存在") {
      super(message);
      this.name = "MaEnvironmentNameConflictError";
    }
  }
  class MaEnvironmentInUseError extends Error {
    constructor(message = "环境仍被智能体或进行中的会话引用，不能删除") {
      super(message);
      this.name = "MaEnvironmentInUseError";
    }
  }
  class AgentValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AgentValidationError";
    }
  }
  return {
    MaEnvironmentValidationError,
    MaEnvironmentNotFoundError,
    MaEnvironmentNameConflictError,
    MaEnvironmentInUseError,
    AgentValidationError,
    AgentNotFoundError: AgentValidationError,
    AgentSlugConflictError: AgentValidationError,
    validateAgentInput() {},
    listMaEnvironments: (...args: unknown[]) => listMaEnvironmentsMock(...args),
    countMaEnvironmentReferences: (...args: unknown[]) => countMaEnvironmentReferencesMock(...args),
    createMaEnvironment: (...args: unknown[]) => createMaEnvironmentMock(...args),
    updateMaEnvironment: (...args: unknown[]) => updateMaEnvironmentMock(...args),
    deleteMaEnvironment: (...args: unknown[]) => deleteMaEnvironmentMock(...args),
    getMaEnvironment: (...args: unknown[]) => getMaEnvironmentMock(...args),
  };
});

const { GET, POST } = await import("../route");
const { PATCH, DELETE } = await import("../[envId]/route");

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin ma-environments routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listMaEnvironmentsMock.mockReset();
    countMaEnvironmentReferencesMock.mockReset();
    createMaEnvironmentMock.mockReset();
    updateMaEnvironmentMock.mockReset();
    deleteMaEnvironmentMock.mockReset();
    getMaEnvironmentMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("GET returns environments with reference counts", async () => {
    listMaEnvironmentsMock.mockResolvedValue([{ id: "env_1", name: "cloud" }]);
    countMaEnvironmentReferencesMock.mockResolvedValue({ agents: 2, activeSessions: 1, openWorkItems: 0 });
    const response = await GET(new Request("http://localhost/api/admin/ma-environments"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: { environments?: Array<{ id: string; references?: { agents: number } }> };
    };
    expect(body.data?.environments?.[0]?.references?.agents).toBe(2);
  });

  it("POST creates with session user as createdBy", async () => {
    createMaEnvironmentMock.mockResolvedValue({ id: "env_1" });
    const response = await POST(
      jsonRequest("http://localhost/api/admin/ma-environments", "POST", { name: "云端", type: "cloud" }),
    );
    expect(response.status).toBe(200);
    expect(createMaEnvironmentMock).toHaveBeenCalledWith(
      "tenant_test",
      expect.objectContaining({ name: "云端", type: "cloud" }),
      "user_1",
    );
  });

  it("POST maps MaEnvironmentValidationError to 400", async () => {
    const { MaEnvironmentValidationError } = await import("@agenticx/iam-core");
    createMaEnvironmentMock.mockRejectedValue(new MaEnvironmentValidationError("环境名称不合法"));
    const response = await POST(
      jsonRequest("http://localhost/api/admin/ma-environments", "POST", { name: "云端", type: "cloud" }),
    );
    expect(response.status).toBe(400);
  });

  it("PATCH maps MaEnvironmentNameConflictError to 409", async () => {
    const { MaEnvironmentNameConflictError } = await import("@agenticx/iam-core");
    updateMaEnvironmentMock.mockRejectedValue(new MaEnvironmentNameConflictError());
    const response = await PATCH(jsonRequest("http://localhost/api/admin/ma-environments/env_1", "PATCH", { name: "云端" }), {
      params: Promise.resolve({ envId: "env_1" }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("40900");
  });

  it("DELETE maps MaEnvironmentInUseError to 409", async () => {
    const { MaEnvironmentInUseError } = await import("@agenticx/iam-core");
    deleteMaEnvironmentMock.mockRejectedValue(new MaEnvironmentInUseError());
    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ envId: "env_1" }) });
    expect(response.status).toBe(409);
  });

  it("DELETE maps not found to 404", async () => {
    const { MaEnvironmentNotFoundError } = await import("@agenticx/iam-core");
    deleteMaEnvironmentMock.mockRejectedValue(new MaEnvironmentNotFoundError());
    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ envId: "missing" }) });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("40400");
  });

  it("rejects unsupported fields", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/admin/ma-environments", "POST", { name: "云端", type: "cloud", foo: 1 }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("不支持的字段：foo");
    expect(createMaEnvironmentMock).not.toHaveBeenCalled();
  });
});

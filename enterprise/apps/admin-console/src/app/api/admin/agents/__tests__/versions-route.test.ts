import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listAgentVersionsMock = vi.fn();
const getAgentWithMaMock = vi.fn();
const previewAgentManifestMock = vi.fn();
const createAgentVersionMock = vi.fn();
const getAgentVersionMock = vi.fn();

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
  class AgentVersionConflictError extends Error {
    currentLatestVersion: number;
    constructor(current: number) {
      super("版本已被他人更新，请刷新后重试");
      this.name = "AgentVersionConflictError";
      this.currentLatestVersion = current;
    }
  }
  class AgentNotFoundError extends Error {
    constructor() {
      super("智能体不存在");
      this.name = "AgentNotFoundError";
    }
  }
  return {
    AgentValidationError,
    AgentNotFoundError,
    AgentSlugConflictError: AgentNotFoundError,
    AgentVersionConflictError,
    validateAgentInput() {},
    listAgentVersions: (...args: unknown[]) => listAgentVersionsMock(...args),
    getAgentWithMa: (...args: unknown[]) => getAgentWithMaMock(...args),
    previewAgentManifest: (...args: unknown[]) => previewAgentManifestMock(...args),
    createAgentVersion: (...args: unknown[]) => createAgentVersionMock(...args),
    getAgentVersion: (...args: unknown[]) => getAgentVersionMock(...args),
  };
});

const { GET, POST } = await import("../[agentId]/versions/route");
const { GET: getVersion } = await import("../[agentId]/versions/[version]/route");

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin agent version routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listAgentVersionsMock.mockReset();
    getAgentWithMaMock.mockReset();
    previewAgentManifestMock.mockReset();
    createAgentVersionMock.mockReset();
    getAgentVersionMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("GET lists versions and returns agent with ma fields", async () => {
    listAgentVersionsMock.mockResolvedValue([{ version: 1 }]);
    getAgentWithMaMock.mockResolvedValue({ id: "a1", latestVersion: 1, effectiveVersion: 1 });
    const response = await GET(new Request("http://localhost/api/admin/agents/a1/versions"), {
      params: Promise.resolve({ agentId: "a1" }),
    });
    expect(response.status).toBe(200);
    const versionsOrder = listAgentVersionsMock.mock.invocationCallOrder[0];
    const agentOrder = getAgentWithMaMock.mock.invocationCallOrder[0];
    expect(versionsOrder).toEqual(expect.any(Number));
    expect(agentOrder).toEqual(expect.any(Number));
    expect(versionsOrder ?? 0).toBeLessThan(agentOrder ?? 0);
    const body = (await response.json()) as { data?: { agent?: { effectiveVersion?: number }; versions?: unknown[] } };
    expect(body.data?.agent?.effectiveVersion).toBe(1);
    expect(body.data?.versions).toHaveLength(1);
  });

  it("POST dryRun returns normalized manifest", async () => {
    previewAgentManifestMock.mockResolvedValue({ ok: true, normalized: { schema: "agx.agent/v1" }, manifestHash: "sha256:abc" });
    const response = await POST(post("http://localhost/api/admin/agents/a1/versions?dryRun=1", { manifest: { schema: "agx.agent/v1" } }), {
      params: Promise.resolve({ agentId: "a1" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { ok?: boolean; manifestHash?: string } };
    expect(body.data?.ok).toBe(true);
    expect(body.data?.manifestHash).toBe("sha256:abc");
    expect(createAgentVersionMock).not.toHaveBeenCalled();
  });

  it("POST dryRun maps invalid manifest to 400 with errors", async () => {
    previewAgentManifestMock.mockResolvedValue({ ok: false, errors: ["manifest.model: is required"] });
    const response = await POST(post("http://localhost/api/admin/agents/a1/versions?dryRun=1", { manifest: { schema: "agx.agent/v1" } }), {
      params: Promise.resolve({ agentId: "a1" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { data?: { errors?: string[] } };
    expect(body.data?.errors).toEqual(["manifest.model: is required"]);
    expect(createAgentVersionMock).not.toHaveBeenCalled();
  });

  it("POST creates a version with source admin and createdBy session user", async () => {
    createAgentVersionMock.mockResolvedValue({ version: { version: 2 }, created: true });
    getAgentWithMaMock.mockResolvedValue({ id: "a1", latestVersion: 2 });
    const response = await POST(
      post("http://localhost/api/admin/agents/a1/versions", {
        manifest: { schema: "agx.agent/v1", model: "openai/gpt-4o" },
        expectedLatestVersion: 1,
        note: "加工具",
      }),
      { params: Promise.resolve({ agentId: "a1" }) },
    );
    expect(response.status).toBe(200);
    expect(createAgentVersionMock).toHaveBeenCalledWith("tenant_test", "a1", {
      manifest: { schema: "agx.agent/v1", model: "openai/gpt-4o" },
      expectedLatestVersion: 1,
      note: "加工具",
      createdBy: "user_1",
      source: "admin",
    });
  });

  it("POST maps AgentVersionConflictError to 409 with currentLatestVersion", async () => {
    const { AgentVersionConflictError } = await import("@agenticx/iam-core");
    createAgentVersionMock.mockRejectedValue(new AgentVersionConflictError(4));
    const response = await POST(
      post("http://localhost/api/admin/agents/a1/versions", { manifest: { schema: "agx.agent/v1" }, expectedLatestVersion: 1 }),
      { params: Promise.resolve({ agentId: "a1" }) },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { data?: { currentLatestVersion?: number; errorCode?: string } };
    expect(body.data?.errorCode).toBe("agent_version_conflict");
    expect(body.data?.currentLatestVersion).toBe(4);
  });

  it("POST rejects non-object manifest", async () => {
    const response = await POST(
      post("http://localhost/api/admin/agents/a1/versions", { manifest: ["nope"], expectedLatestVersion: 1 }),
      { params: Promise.resolve({ agentId: "a1" }) },
    );
    expect(response.status).toBe(400);
    expect(createAgentVersionMock).not.toHaveBeenCalled();
  });

  it("POST rejects missing expectedLatestVersion", async () => {
    const response = await POST(post("http://localhost/api/admin/agents/a1/versions", { manifest: { schema: "agx.agent/v1" } }), {
      params: Promise.resolve({ agentId: "a1" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("缺少当前版本号，请刷新后重试");
    expect(createAgentVersionMock).not.toHaveBeenCalled();
  });

  it("GET single version rejects non-integer version", async () => {
    const response = await getVersion(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: "a1", version: "abc" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("版本号不合法");
    expect(getAgentVersionMock).not.toHaveBeenCalled();
  });

  it("returns auth response when scope check fails", async () => {
    const denied = NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 });
    requireAdminScopeMock.mockResolvedValue({ ok: false, response: denied });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ agentId: "a1" }) });
    expect(response.status).toBe(403);
    expect(listAgentVersionsMock).not.toHaveBeenCalled();
  });
});

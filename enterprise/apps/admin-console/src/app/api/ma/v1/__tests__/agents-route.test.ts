import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const listAgentsWithMaMock = vi.fn();
const createAgentWithInitialVersionMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentMaSettingsMock = vi.fn();
const getAgentWithMaMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/capability-packs-store", () => ({
  normalizeAssignmentKeys(keys: readonly string[]) {
    const cleaned: string[] = [];
    for (const raw of keys) {
      const key = String(raw ?? "").trim();
      if (key && !cleaned.includes(key)) cleaned.push(key);
    }
    return cleaned;
  },
}));
vi.mock("@agenticx/iam-core", () => {
  class AgentSlugConflictError extends Error {
    constructor() {
      super("标识已存在");
      this.name = "AgentSlugConflictError";
    }
  }
  class AgentManifestInvalidError extends Error {
    errors: string[];
    constructor(errors: string[]) {
      super("定义校验未通过");
      this.name = "AgentManifestInvalidError";
      this.errors = errors;
    }
  }
  return {
    AgentSlugConflictError,
    AgentManifestInvalidError,
    AgentValidationError: AgentSlugConflictError,
    AgentNotFoundError: AgentSlugConflictError,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    listAgentsWithMa: (...args: unknown[]) => listAgentsWithMaMock(...args),
    createAgentWithInitialVersion: (...args: unknown[]) => createAgentWithInitialVersionMock(...args),
    updateAgent: (...args: unknown[]) => updateAgentMock(...args),
    updateAgentMaSettings: (...args: unknown[]) => updateAgentMaSettingsMock(...args),
    getAgentWithMa: (...args: unknown[]) => getAgentWithMaMock(...args),
  };
});

const { GET, POST } = await import("../agents/route");
const { GET: getOne, PATCH } = await import("../agents/[agentId]/route");

const AGENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function agent() {
  return {
    id: AGENT_ID,
    tenantId: "tenant_pat",
    slug: "report-bot",
    displayName: "报告助手",
    description: null,
    systemPrompt: "",
    model: "openai/gpt-4o",
    runtime: "cloud",
    capabilityIds: [],
    assignmentKeys: ["all"],
    workerKeys: [],
    status: "active",
    lifecycle: "draft",
    origin: "enterprise",
    ownerUserId: null,
    localAvatarId: null,
    metadata: {},
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
    latestVersion: 1,
    defaultEnvironmentId: null,
    versionRouting: "follow_latest",
    pinnedVersion: null,
    effectiveVersion: 1,
  };
}

function asPat(scopes: string[]) {
  verifyPatMock.mockResolvedValue({
    id: 7,
    tenantId: "tenant_pat",
    userId: "user_pat",
    deptId: null,
    scopes,
    status: "active",
  });
}

function authed(url: string, scopes: string[], init?: RequestInit) {
  asPat(scopes);
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer agx-pat-test");
  return new Request(url, { ...init, headers });
}

describe("public ma agents routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    listAgentsWithMaMock.mockReset();
    createAgentWithInitialVersionMock.mockReset();
    updateAgentMock.mockReset();
    updateAgentMaSettingsMock.mockReset();
    getAgentWithMaMock.mockReset();
    vi.stubEnv("DEFAULT_TENANT_ID", "other");
  });

  it("GET requires ma:agents:read", async () => {
    const missing = await GET(new Request("http://localhost/api/ma/v1/agents"));
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("unauthorized");

    const forbidden = await GET(authed("http://localhost/api/ma/v1/agents", ["ma:sessions:read"]));
    expect(forbidden.status).toBe(403);
    const body = (await forbidden.json()) as { error: { code: string; details?: { required?: string } } };
    expect(body.error.code).toBe("forbidden_scope");
    expect(body.error.details?.required).toBe("ma:agents:read");
  });

  it("GET returns envelopes with agent and routing", async () => {
    listAgentsWithMaMock.mockResolvedValue([agent()]);
    const response = await GET(authed("http://localhost/api/ma/v1/agents", ["ma:agents:read"]));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ agent: Record<string, unknown>; routing: { effective_version: number } }> };
    const first = body.data[0];
    expect(first).toBeDefined();
    expect(Object.keys(first?.agent ?? {}).sort()).toEqual(
      [
        "assignment_keys",
        "default_environment_id",
        "description",
        "display_name",
        "id",
        "latest_version",
        "lifecycle",
        "origin",
        "slug",
        "status",
        "tenant_id",
        "worker_keys",
      ].sort(),
    );
    expect(first?.routing.effective_version).toBe(1);
  });

  it("GET uses PAT tenant not DEFAULT_TENANT_ID", async () => {
    listAgentsWithMaMock.mockResolvedValue([]);
    await GET(authed("http://localhost/api/ma/v1/agents", ["ma:agents:read"]));
    expect(listAgentsWithMaMock).toHaveBeenCalledWith("tenant_pat");
  });

  it("POST creates draft agent with initial version", async () => {
    createAgentWithInitialVersionMock.mockResolvedValue({
      agent: agent(),
      version: {
        id: "v",
        tenantId: "tenant_pat",
        agentId: AGENT_ID,
        version: 1,
        manifest: { schema: "agx.agent/v1" },
        manifestHash: "sha256:abc",
        note: null,
        source: "api",
        createdBy: "user_pat",
        createdAt: "2026-10-26T08:00:00.000Z",
      },
    });
    const response = await POST(
      authed("http://localhost/api/ma/v1/agents", ["ma:agents:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "report-bot",
          display_name: "报告助手",
          manifest: { schema: "agx.agent/v1", model: "openai/gpt-4o", system: "你是报告助手" },
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(createAgentWithInitialVersionMock).toHaveBeenCalledWith(
      "tenant_pat",
      expect.objectContaining({ lifecycle: "draft", origin: "enterprise", model: "", systemPrompt: "" }),
      expect.objectContaining({ source: "api", createdBy: "user_pat" }),
    );
  });

  it("POST rejects unknown field", async () => {
    const response = await POST(
      authed("http://localhost/api/ma/v1/agents", ["ma:agents:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "report-bot", display_name: "报告助手", manifest: {}, foo: 1 }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("unknown field: foo");
    expect(createAgentWithInitialVersionMock).not.toHaveBeenCalled();
  });

  it("POST maps slug conflict to 409 agent_slug_conflict", async () => {
    const { AgentSlugConflictError } = await import("@agenticx/iam-core");
    createAgentWithInitialVersionMock.mockRejectedValue(new AgentSlugConflictError());
    const response = await POST(
      authed("http://localhost/api/ma/v1/agents", ["ma:agents:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "report-bot", display_name: "报告助手", manifest: { schema: "agx.agent/v1" } }),
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("agent_slug_conflict");
  });

  it("POST maps invalid manifest to 400 manifest_invalid", async () => {
    const { AgentManifestInvalidError } = await import("@agenticx/iam-core");
    createAgentWithInitialVersionMock.mockRejectedValue(new AgentManifestInvalidError(["manifest.model: is required"]));
    const response = await POST(
      authed("http://localhost/api/ma/v1/agents", ["ma:agents:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "report-bot", display_name: "报告助手", manifest: { schema: "agx.agent/v1" } }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details?: { errors?: string[] } } };
    expect(body.error.code).toBe("manifest_invalid");
    expect(body.error.details?.errors).toEqual(["manifest.model: is required"]);
  });

  it("PATCH rejects manifest keys with guidance message", async () => {
    const response = await PATCH(
      authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}`, ["ma:agents:write"], {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { schema: "agx.agent/v1" } }),
      }),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("use POST /ma/v1/agents/{id}/versions to change the manifest");
    expect(updateAgentMock).not.toHaveBeenCalled();
  });

  it("PATCH updates basic fields then routing", async () => {
    updateAgentMock.mockResolvedValue(agent());
    updateAgentMaSettingsMock.mockResolvedValue(agent());
    getAgentWithMaMock.mockResolvedValue(agent());
    const response = await PATCH(
      authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}`, ["ma:agents:write"], {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: "新名字", routing: { mode: "pinned", pinned_version: 1 } }),
      }),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );
    expect(response.status).toBe(200);
    const basicOrder = updateAgentMock.mock.invocationCallOrder[0];
    const settingsOrder = updateAgentMaSettingsMock.mock.invocationCallOrder[0];
    expect(basicOrder ?? 0).toBeLessThan(settingsOrder ?? 0);
    expect(updateAgentMock).toHaveBeenCalledWith("tenant_pat", AGENT_ID, expect.objectContaining({ displayName: "新名字" }));
    expect(updateAgentMaSettingsMock).toHaveBeenCalledWith(
      "tenant_pat",
      AGENT_ID,
      expect.objectContaining({ versionRouting: "pinned", pinnedVersion: 1 }),
    );
  });

  it("GET single rejects malformed id as agent_not_found", async () => {
    const response = await getOne(authed("http://localhost/api/ma/v1/agents/nope", ["ma:agents:read"]), {
      params: Promise.resolve({ agentId: "nope" }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("agent_not_found");
    expect(getAgentWithMaMock).not.toHaveBeenCalled();
  });
});

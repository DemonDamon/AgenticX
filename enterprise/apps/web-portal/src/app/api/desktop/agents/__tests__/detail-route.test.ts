import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const resolveAssignmentKeysForUser = vi.fn();
const listAgentsVisibleToKeys = vi.fn();
const getAgentWithMa = vi.fn();
const listMaEnvironments = vi.fn();
const getAgentVersion = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  resolveAssignmentKeysForUser: (...args: unknown[]) => resolveAssignmentKeysForUser(...args),
  listAgentsVisibleToKeys: (...args: unknown[]) => listAgentsVisibleToKeys(...args),
  getAgentWithMa: (...args: unknown[]) => getAgentWithMa(...args),
  listMaEnvironments: (...args: unknown[]) => listMaEnvironments(...args),
  getAgentVersion: (...args: unknown[]) => getAgentVersion(...args),
}));

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const ENV = "01JQMZ8K3N4P5Q6R7S8T9VWXY0";
const MCP_URL = "https://mcp.example.com/";

function identity() {
  return {
    userId: "u1",
    tenantId: "t1",
    deptId: "d1",
    email: "a@example.invalid",
    displayName: "A",
    tokenId: 1,
    scopes: ["workspace:chat", "desktop:managed"],
  };
}

function agent() {
  return {
    id: AGENT,
    tenantId: "t1",
    slug: "report-bot",
    displayName: "报告助手",
    description: "周报",
    systemPrompt: "你是报告助手",
    model: "openai/gpt-4o",
    runtime: "cloud",
    capabilityIds: [],
    assignmentKeys: ["all"],
    workerKeys: [],
    status: "active",
    lifecycle: "published",
    origin: "enterprise",
    ownerUserId: null,
    localAvatarId: null,
    metadata: {},
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
  };
}

function request(): Request {
  return new Request(`http://localhost:3000/api/desktop/agents/${AGENT}`);
}

function call(agentId: string) {
  return {
    params: Promise.resolve({ agentId }),
  };
}

describe("GET /api/desktop/agents/:agentId", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    resolveAssignmentKeysForUser.mockReset();
    listAgentsVisibleToKeys.mockReset();
    getAgentWithMa.mockReset();
    listMaEnvironments.mockReset();
    getAgentVersion.mockReset();
    resolveDesktopIdentity.mockResolvedValue(identity());
    resolveAssignmentKeysForUser.mockResolvedValue(["all"]);
    listMaEnvironments.mockResolvedValue([]);
  });

  it("returns 404 for agents not assigned to the viewer", async () => {
    listAgentsVisibleToKeys.mockResolvedValue([]);
    const { GET } = await import("../[agentId]/route");
    const res = await GET(request(), call(AGENT));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "40400", message: "智能体不存在或未分配给你" });
    expect(getAgentVersion).not.toHaveBeenCalled();
  });

  it("returns 404 for malformed id", async () => {
    const { GET } = await import("../[agentId]/route");
    const res = await GET(request(), call("abc"));
    expect(res.status).toBe(404);
    expect(listAgentsVisibleToKeys).not.toHaveBeenCalled();
    expect(getAgentVersion).not.toHaveBeenCalled();
  });

  it("returns summary of effective version", async () => {
    const row = agent();
    listAgentsVisibleToKeys.mockResolvedValue([row]);
    getAgentWithMa.mockResolvedValue({
      ...row,
      latestVersion: 3,
      defaultEnvironmentId: ENV,
      versionRouting: "pinned",
      pinnedVersion: 2,
      effectiveVersion: 2,
    });
    listMaEnvironments.mockResolvedValue([{
      id: ENV,
      tenantId: "t1",
      name: "研发桌面",
      description: null,
      type: "desktop_worker",
      config: { type: "desktop_worker", worker_keys: [] },
      status: "active",
      createdBy: null,
      createdAt: "2026-10-26T08:00:00.000Z",
      updatedAt: "2026-10-26T08:00:00.000Z",
    }]);
    getAgentVersion.mockResolvedValue({
      id: "ver",
      tenantId: "t1",
      agentId: AGENT,
      version: 2,
      manifestHash: "sha256:abc",
      note: "加工具",
      source: "admin",
      createdBy: "u1",
      createdAt: "2026-10-26T08:00:00.000Z",
      manifest: {
        model: "openai/gpt-4o",
        system: "你是报告助手",
        tools: [
          {
            type: "agx_builtin",
            default_policy: "always_allow",
            configs: [{ name: "bash_exec", policy: "always_ask", enabled: true }],
          },
          {
            type: "mcp",
            server: "github",
            default_policy: "always_ask",
            configs: [{ name: "get_issue", policy: "always_allow", enabled: true }],
          },
        ],
        mcp_servers: [{ name: "github", url: MCP_URL, transport: "http" }],
        skills: [{ source: "tenant", id: AGENT, version: "1.2.0" }],
        runtime: { max_tool_rounds: 40 },
        metadata: { welcome_message: "欢迎", suggested_questions: ["本周报告？"] },
      },
    });
    const { GET } = await import("../[agentId]/route");
    const res = await GET(request(), call(AGENT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getAgentVersion).toHaveBeenCalledWith("t1", AGENT, 2);
    expect(body.version.version).toBe(2);
    expect(body.version.note).toBe("加工具");
    expect(body.version.createdAt).toBe("2026-10-26T08:00:00.000Z");
    expect(body.agent.effectiveVersion).toBe(2);
    expect(body.agent.defaultEnvironment.name).toBe("研发桌面");
    expect(body.version.summary.builtin.overrides[0]).toEqual({
      name: "bash_exec",
      policy: "always_ask",
      enabled: true,
    });
    expect(body.version.summary.mcp[0].server).toBe("github");
    expect(body.version.summary.mcp[0].transport).toBe("http");
  });

  it("summary never contains mcp urls", async () => {
    const row = agent();
    listAgentsVisibleToKeys.mockResolvedValue([row]);
    getAgentWithMa.mockResolvedValue({
      ...row,
      latestVersion: 1,
      defaultEnvironmentId: null,
      versionRouting: "follow_latest",
      pinnedVersion: null,
      effectiveVersion: 1,
    });
    getAgentVersion.mockResolvedValue({
      version: 1,
      createdAt: "2026-10-26T08:00:00.000Z",
      note: null,
      manifest: {
        model: "openai/gpt-4o",
        system: "系统",
        tools: [{ type: "mcp", server: "github", default_policy: "always_ask", configs: [] }],
        mcp_servers: [{ name: "github", url: MCP_URL, transport: "sse" }],
      },
    });
    const { GET } = await import("../[agentId]/route");
    const res = await GET(request(), call(AGENT));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(MCP_URL);
    expect(body.version.summary.mcp[0]).toEqual({
      server: "github",
      transport: "sse",
      defaultPolicy: "always_ask",
      overrides: [],
    });
    expect(Object.keys(body.version.summary.mcp[0])).not.toContain("url");
  });

  it("returns 404 when the effective version is missing", async () => {
    const row = agent();
    listAgentsVisibleToKeys.mockResolvedValue([row]);
    getAgentWithMa.mockResolvedValue({
      ...row,
      latestVersion: 2,
      defaultEnvironmentId: null,
      versionRouting: "pinned",
      pinnedVersion: 2,
      effectiveVersion: 2,
    });
    const missing = new Error("missing");
    missing.name = "AgentVersionNotFoundError";
    getAgentVersion.mockRejectedValue(missing);
    const { GET } = await import("../[agentId]/route");
    const res = await GET(request(), call(AGENT));
    expect(res.status).toBe(404);
  });
});

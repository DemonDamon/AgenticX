import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const listAgentsWithMa = vi.fn();
const getAgentWithMa = vi.fn();
const getAgentVersion = vi.fn();
const listAgentVersions = vi.fn();
const createAgentVersion = vi.fn();
const updateAgentMaSettings = vi.fn();

vi.mock("../../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  listAgentsWithMa: (...args: unknown[]) => listAgentsWithMa(...args),
  getAgentWithMa: (...args: unknown[]) => getAgentWithMa(...args),
  getAgentVersion: (...args: unknown[]) => getAgentVersion(...args),
  listAgentVersions: (...args: unknown[]) => listAgentVersions(...args),
  createAgentVersion: (...args: unknown[]) => createAgentVersion(...args),
  updateAgentMaSettings: (...args: unknown[]) => updateAgentMaSettings(...args),
}));

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";

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

function agent(patch: Record<string, unknown> = {}) {
  return {
    id: AGENT,
    tenantId: "t1",
    slug: "sales",
    displayName: "销售周报",
    description: null,
    systemPrompt: "",
    model: "openai/gpt-4o",
    runtime: "desktop_worker",
    capabilityIds: [],
    assignmentKeys: ["u1"],
    workerKeys: ["u1"],
    status: "active",
    lifecycle: "draft",
    origin: "employee",
    ownerUserId: "u1",
    localAvatarId: "nl-sales",
    metadata: {},
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
    latestVersion: 2,
    defaultEnvironmentId: null,
    versionRouting: "follow_latest" as const,
    pinnedVersion: null,
    effectiveVersion: 2,
    ...patch,
  };
}

function versionRow(version: number) {
  return {
    id: `v${version}`,
    tenantId: "t1",
    agentId: AGENT,
    version,
    manifest: { schema: "agx.agent/v1", model: "openai/gpt-4o" },
    manifestHash: `sha256:${version}`,
    note: version === 2 ? "加入联网检索" : null,
    source: "desktop",
    createdBy: "u1",
    createdAt: `2026-10-26T08:00:0${version % 10}.000Z`,
  };
}

function assertNoWrites() {
  expect(createAgentVersion).not.toHaveBeenCalled();
  expect(updateAgentMaSettings).not.toHaveBeenCalled();
}

describe("GET /api/desktop/agents/drafts", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    listAgentsWithMa.mockReset();
    createAgentVersion.mockReset();
    updateAgentMaSettings.mockReset();
    resolveDesktopIdentity.mockResolvedValue(identity());
  });

  it("lists only my employee agents", async () => {
    listAgentsWithMa.mockResolvedValue([
      agent({ id: "other", ownerUserId: "u2", displayName: "别人", updatedAt: "2026-10-03T00:00:00.000Z" }),
      agent({ id: "enterprise", origin: "enterprise", ownerUserId: "u1", localAvatarId: "nl-ent", updatedAt: "2026-10-04T00:00:00.000Z" }),
      agent({ id: "nolocal", localAvatarId: null, updatedAt: "2026-10-05T00:00:00.000Z" }),
      agent({ id: "older", displayName: "较早", updatedAt: "2026-10-01T00:00:00.000Z", localAvatarId: "nl-old" }),
      agent({ id: "newer", displayName: "较新", updatedAt: "2026-10-03T00:00:00.000Z", localAvatarId: "nl-new" }),
      agent({ id: "mid", displayName: "中间", updatedAt: "2026-10-02T00:00:00.000Z", localAvatarId: "nl-mid" }),
    ]);
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/desktop/agents/drafts"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents.map((item: { agent_id: string }) => item.agent_id)).toEqual(["newer", "mid", "older"]);
    expect(Object.keys(body.agents[0])).toEqual([
      "agent_id",
      "display_name",
      "description",
      "local_avatar_id",
      "lifecycle",
      "latest_version",
      "effective_version",
      "routing_mode",
      "updated_at",
    ]);
    expect(body.agents[0].display_name).toBe("较新");
    expect(body.agents[0].description).toBeNull();
    expect(body.agents[0].updated_at).toBe("2026-10-03T00:00:00.000Z");
    expect(body.agents[0].routing_mode).toBe("follow_latest");
    assertNoWrites();
  });

  it("returns 401 without a token", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/desktop/agents/drafts"));
    expect(res.status).toBe(401);
    expect(listAgentsWithMa).not.toHaveBeenCalled();
    assertNoWrites();
  });
});

describe("GET /api/desktop/agents/drafts/:agentId", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    getAgentWithMa.mockReset();
    getAgentVersion.mockReset();
    listAgentVersions.mockReset();
    createAgentVersion.mockReset();
    updateAgentMaSettings.mockReset();
    resolveDesktopIdentity.mockResolvedValue(identity());
    getAgentVersion.mockResolvedValue(versionRow(2));
    listAgentVersions.mockResolvedValue([versionRow(2), versionRow(1)]);
  });

  function call(agentId: string, version?: string) {
    const query = version == null ? "" : `?version=${version}`;
    return import("../[agentId]/route").then(({ GET }) =>
      GET(new Request(`http://localhost/api/desktop/agents/drafts/${agentId}${query}`), {
        params: Promise.resolve({ agentId }),
      }),
    );
  }

  it("returns 404 for others' agent", async () => {
    getAgentWithMa.mockResolvedValue(agent({ ownerUserId: "u2" }));
    const other = await call(AGENT);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ code: "40400", message: "智能体不存在" });
    getAgentWithMa.mockResolvedValue(agent({ origin: "enterprise", ownerUserId: "u1" }));
    const enterprise = await call(AGENT);
    expect(enterprise.status).toBe(404);
    expect(getAgentVersion).not.toHaveBeenCalled();
    assertNoWrites();
  });

  it("defaults to latest version", async () => {
    getAgentWithMa.mockResolvedValue(agent({ latestVersion: 4, effectiveVersion: 2, versionRouting: "pinned" }));
    getAgentVersion.mockResolvedValue(versionRow(4));
    const res = await call(AGENT);
    expect(res.status).toBe(200);
    expect(getAgentVersion).toHaveBeenCalledWith("t1", AGENT, 4);
    const body = await res.json();
    expect(body.agent.latest_version).toBe(4);
    expect(body.agent.effective_version).toBe(2);
    expect(body.agent.routing_mode).toBe("pinned");
    expect(body.version.version).toBe(4);
    expect(body.version.manifest_hash).toBe("sha256:4");
    expect(body.version.note).toBeNull();
    expect(body.version.source).toBe("desktop");
    expect(body.version.created_at).toBe("2026-10-26T08:00:04.000Z");
    assertNoWrites();
  });

  it("bad version → 400", async () => {
    getAgentWithMa.mockResolvedValue(agent());
    const res = await call(AGENT, "0");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "40000", message: "version 不合法" });
    expect(getAgentVersion).not.toHaveBeenCalled();
    assertNoWrites();
  });

  it("missing version → 404 40401", async () => {
    getAgentWithMa.mockResolvedValue(agent());
    getAgentVersion.mockRejectedValue(Object.assign(new Error("版本不存在"), { name: "AgentVersionNotFoundError" }));
    const res = await call(AGENT, "9");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "40401", message: "版本不存在" });
    assertNoWrites();
  });

  it("versions limited to 20", async () => {
    getAgentWithMa.mockResolvedValue(agent());
    listAgentVersions.mockImplementation(async (_tenant: string, _id: string, opts: { limit?: number }) => {
      expect(opts).toEqual({ limit: 20 });
      return Array.from({ length: 25 }, (_, index) => versionRow(25 - index));
    });
    const res = await call(AGENT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toHaveLength(20);
    expect(body.versions[0]).toEqual({
      version: 25,
      note: null,
      source: "desktop",
      created_at: versionRow(25).createdAt,
    });
    expect(listAgentVersions).toHaveBeenCalledWith("t1", AGENT, { limit: 20 });
    assertNoWrites();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const listAgentVersionsMock = vi.fn();
const createAgentVersionMock = vi.fn();
const getAgentVersionMock = vi.fn();
const getAgentWithMaMock = vi.fn();
const ensureAgentVersionOneMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => {
  class AgentVersionConflictError extends Error {
    currentLatestVersion: number;
    constructor(current: number) {
      super("changed");
      this.name = "AgentVersionConflictError";
      this.currentLatestVersion = current;
    }
  }
  return {
    AgentVersionConflictError,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    listAgentVersions: (...args: unknown[]) => listAgentVersionsMock(...args),
    createAgentVersion: (...args: unknown[]) => createAgentVersionMock(...args),
    getAgentVersion: (...args: unknown[]) => getAgentVersionMock(...args),
    getAgentWithMa: (...args: unknown[]) => getAgentWithMaMock(...args),
    ensureAgentVersionOne: (...args: unknown[]) => ensureAgentVersionOneMock(...args),
  };
});

const { GET, POST } = await import("../agents/[agentId]/versions/route");
const { GET: getVersion } = await import("../agents/[agentId]/versions/[version]/route");

const AGENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function versionRow(version: number, created = true) {
  return {
    id: `v${version}`,
    tenantId: "tenant_pat",
    agentId: AGENT_ID,
    version,
    manifest: { schema: "agx.agent/v1" },
    manifestHash: "sha256:abc",
    note: null,
    source: "api",
    createdBy: "user_pat",
    createdAt: "2026-10-26T08:00:00.000Z",
    created,
  };
}

function authed(url: string, init?: RequestInit) {
  verifyPatMock.mockResolvedValue({
    id: 7,
    tenantId: "tenant_pat",
    userId: "user_pat",
    deptId: null,
    scopes: ["ma:agents:read", "ma:agents:write"],
    status: "active",
  });
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer agx-pat-test");
  return new Request(url, { ...init, headers });
}

describe("public ma version routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    listAgentVersionsMock.mockReset();
    createAgentVersionMock.mockReset();
    getAgentVersionMock.mockReset();
    getAgentWithMaMock.mockReset();
    ensureAgentVersionOneMock.mockReset();
    ensureAgentVersionOneMock.mockResolvedValue({ status: "exists" });
  });

  it("POST returns 201 when created", async () => {
    createAgentVersionMock.mockResolvedValue({ version: versionRow(3), created: true });
    const response = await POST(
      authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { schema: "agx.agent/v1" }, expected_latest_version: 2 }),
      }),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { created: boolean; version: { version: number } };
    expect(body.created).toBe(true);
    expect(body.version.version).toBe(3);
  });

  it("POST returns 200 created false when unchanged", async () => {
    createAgentVersionMock.mockResolvedValue({ version: versionRow(2), created: false });
    const response = await POST(
      authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { schema: "agx.agent/v1" }, expected_latest_version: 2 }),
      }),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { created: boolean };
    expect(body.created).toBe(false);
  });

  it("POST maps conflict to 409 with current_latest_version", async () => {
    const { AgentVersionConflictError } = await import("@agenticx/iam-core");
    createAgentVersionMock.mockRejectedValue(new AgentVersionConflictError(3));
    const response = await POST(
      authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { schema: "agx.agent/v1" }, expected_latest_version: 2 }),
      }),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; details?: { current_latest_version?: number } } };
    expect(body.error.code).toBe("agent_version_conflict");
    expect(body.error.details?.current_latest_version).toBe(3);
  });

  it("POST requires expected_latest_version", async () => {
    const response = await POST(
      authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { schema: "agx.agent/v1" } }),
      }),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("expected_latest_version is required");
    expect(createAgentVersionMock).not.toHaveBeenCalled();
  });

  it("GET list returns next_before_version when page is full", async () => {
    listAgentVersionsMock.mockResolvedValue([versionRow(5), versionRow(4)]);
    const response = await GET(authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions?limit=2`), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { next_before_version: number | null };
    expect(body.next_before_version).toBe(4);
  });

  it("GET version resolves latest and effective", async () => {
    getAgentWithMaMock.mockResolvedValue({ latestVersion: 3, effectiveVersion: 1 });
    getAgentVersionMock.mockImplementation(async (_tenant: string, _id: string, version: number) => versionRow(version));
    const latest = await getVersion(authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions/latest`), {
      params: Promise.resolve({ agentId: AGENT_ID, version: "latest" }),
    });
    const effective = await getVersion(authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions/effective`), {
      params: Promise.resolve({ agentId: AGENT_ID, version: "effective" }),
    });
    expect(latest.status).toBe(200);
    expect(effective.status).toBe(200);
    expect(getAgentVersionMock).toHaveBeenNthCalledWith(1, "tenant_pat", AGENT_ID, 3);
    expect(getAgentVersionMock).toHaveBeenNthCalledWith(2, "tenant_pat", AGENT_ID, 1);
  });

  it("GET version rejects abc", async () => {
    const response = await getVersion(authed(`http://localhost/api/ma/v1/agents/${AGENT_ID}/versions/abc`), {
      params: Promise.resolve({ agentId: AGENT_ID, version: "abc" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(getAgentVersionMock).not.toHaveBeenCalled();
  });
});

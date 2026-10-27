import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const ensureAgentVersionOneMock = vi.fn();
const getAgentWithMaMock = vi.fn();
const getAgentVersionMock = vi.fn();
const getMaEnvironmentMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  verifyPat: (...args: unknown[]) => verifyPatMock(...args),
  touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
  ensureAgentVersionOne: (...args: unknown[]) => ensureAgentVersionOneMock(...args),
  getAgentWithMa: (...args: unknown[]) => getAgentWithMaMock(...args),
  getAgentVersion: (...args: unknown[]) => getAgentVersionMock(...args),
  getMaEnvironment: (...args: unknown[]) => getMaEnvironmentMock(...args),
}));

const { GET: getAgentVersionRoute } = await import("../agent-versions/[agentId]/[version]/route");
const { GET: getEnvironmentRoute } = await import("../environments/[envId]/route");
const { POST: introspect } = await import("../pat-introspect/route");

const AGENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ENV_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const TENANT = "01J00000000000000000000001";

function agent() {
  return {
    id: AGENT_ID,
    tenantId: TENANT,
    slug: "report-bot",
    displayName: "报告助手",
    description: null,
    runtime: "cloud",
    assignmentKeys: ["all"],
    workerKeys: [],
    status: "active",
    lifecycle: "published",
    origin: "enterprise",
    latestVersion: 3,
    defaultEnvironmentId: null,
    versionRouting: "pinned",
    pinnedVersion: 1,
    effectiveVersion: 1,
  };
}

function versionRow(version: number) {
  return {
    id: "row",
    tenantId: TENANT,
    agentId: AGENT_ID,
    version,
    manifest: { schema: "agx.agent/v1" },
    manifestHash: "sha256:abc",
    note: null,
    source: "admin",
    createdBy: null,
    createdAt: "2026-10-26T08:00:00.000Z",
  };
}

function withToken(url: string, token = "ma-token", init?: RequestInit) { // gitleaks:allow
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

describe("internal ma routes", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "");
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    ensureAgentVersionOneMock.mockReset();
    getAgentWithMaMock.mockReset();
    getAgentVersionMock.mockReset();
    getMaEnvironmentMock.mockReset();
    ensureAgentVersionOneMock.mockResolvedValue({ status: "exists" });
  });

  it("agent-versions rejects without internal token", async () => {
    const response = await getAgentVersionRoute(
      new Request(`http://localhost/api/internal/ma/agent-versions/${AGENT_ID}/effective?tenant_id=${TENANT}`),
      { params: Promise.resolve({ agentId: AGENT_ID, version: "effective" }) },
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("agent-versions requires tenant_id", async () => {
    const response = await getAgentVersionRoute(
      withToken(`http://localhost/api/internal/ma/agent-versions/${AGENT_ID}/effective`),
      { params: Promise.resolve({ agentId: AGENT_ID, version: "effective" }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBe("tenant_id is required");
  });

  it("agent-versions resolves effective version and returns agent/routing/runtime/version", async () => {
    getAgentWithMaMock.mockResolvedValue(agent());
    getAgentVersionMock.mockResolvedValue(versionRow(1));
    const response = await getAgentVersionRoute(
      withToken(`http://localhost/api/internal/ma/agent-versions/${AGENT_ID}/effective?tenant_id=${TENANT}`),
      { params: Promise.resolve({ agentId: AGENT_ID, version: "effective" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown> & {
      routing: { effective_version: number };
      runtime: string;
      version: { version: number };
    };
    expect(Object.keys(body).sort()).toEqual(["agent", "routing", "runtime", "version"]);
    expect(body.routing.effective_version).toBe(1);
    expect(body.runtime).toBe("cloud");
    expect(body.version.version).toBe(1);
    expect(getAgentVersionMock).toHaveBeenCalledWith(TENANT, AGENT_ID, 1);
  });

  it("agent-versions maps invalid backfill to 404 agent_version_not_found", async () => {
    ensureAgentVersionOneMock.mockResolvedValue({ status: "invalid", errors: ["manifest.model: is required"] });
    const response = await getAgentVersionRoute(
      withToken(`http://localhost/api/internal/ma/agent-versions/${AGENT_ID}/latest?tenant_id=${TENANT}`),
      { params: Promise.resolve({ agentId: AGENT_ID, version: "latest" }) },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("agent_version_not_found");
    expect(getAgentVersionMock).not.toHaveBeenCalled();
  });

  it("environments returns record", async () => {
    getMaEnvironmentMock.mockResolvedValue({
      id: ENV_ID,
      tenantId: TENANT,
      name: "cloud",
      description: "hidden",
      type: "cloud",
      config: { type: "cloud", sandbox_backend: "docker", image: null, egress_allow_domains: ["*.example.com"], idle_ttl_seconds: 3600 },
      status: "active",
      createdBy: null,
      createdAt: "2026-10-26T08:00:00.000Z",
      updatedAt: "2026-10-26T08:00:00.000Z",
    });
    const response = await getEnvironmentRoute(
      withToken(`http://localhost/api/internal/ma/environments/${ENV_ID}?tenant_id=${TENANT}`),
      { params: Promise.resolve({ envId: ENV_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { environment: Record<string, unknown> };
    expect(Object.keys(body.environment).sort()).toEqual(["config", "id", "name", "status", "tenant_id", "type"]);
    expect(body.environment).not.toHaveProperty("description");
  });

  it("pat-introspect returns active false for unknown token", async () => {
    verifyPatMock.mockResolvedValue(null);
    const response = await introspect(
      withToken("http://localhost/api/internal/ma/pat-introspect", "ma-token", {
        method: "POST",
        body: JSON.stringify({ token: "agx-pat-missing" }), // gitleaks:allow
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });

  it("pat-introspect returns identity for valid token without echoing it", async () => {
    const plain = "agx-pat-super-secret-token";
    verifyPatMock.mockResolvedValue({
      id: 42,
      tenantId: TENANT,
      userId: "user_1",
      deptId: null,
      scopes: ["workspace:chat", "ma:sessions:write"],
      status: "active",
    });
    const response = await introspect(
      withToken("http://localhost/api/internal/ma/pat-introspect", "ma-token", {
        method: "POST",
        body: JSON.stringify({ token: plain }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      active: true,
      tenant_id: TENANT,
      user_id: "user_1",
      dept_id: null,
      scopes: ["workspace:chat", "ma:sessions:write"],
      token_id: 42,
    });
    expect(JSON.stringify(body)).not.toContain(plain);
    expect(touchPatLastUsedMock).toHaveBeenCalledWith(42);
  });

  it("pat-introspect requires token in body", async () => {
    const response = await introspect(
      withToken("http://localhost/api/internal/ma/pat-introspect", "ma-token", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBe("token is required");
  });

  it("pat-introspect rejects gateway token", async () => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "gateway-token");
    const response = await introspect(
      withToken("http://localhost/api/internal/ma/pat-introspect", "gateway-token", {
        method: "POST",
        body: JSON.stringify({ token: "agx-pat-x" }), // gitleaks:allow
      }),
    );
    expect(response.status).toBe(401);
  });
});

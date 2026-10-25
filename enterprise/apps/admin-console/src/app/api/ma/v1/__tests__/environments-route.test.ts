import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const listMaEnvironmentsMock = vi.fn();
const createMaEnvironmentMock = vi.fn();
const getMaEnvironmentMock = vi.fn();
const updateMaEnvironmentMock = vi.fn();
const deleteMaEnvironmentMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => {
  class MaEnvironmentInUseError extends Error {
    constructor() {
      super("in use");
      this.name = "MaEnvironmentInUseError";
    }
  }
  return {
    MaEnvironmentInUseError,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    listMaEnvironments: (...args: unknown[]) => listMaEnvironmentsMock(...args),
    createMaEnvironment: (...args: unknown[]) => createMaEnvironmentMock(...args),
    getMaEnvironment: (...args: unknown[]) => getMaEnvironmentMock(...args),
    updateMaEnvironment: (...args: unknown[]) => updateMaEnvironmentMock(...args),
    deleteMaEnvironment: (...args: unknown[]) => deleteMaEnvironmentMock(...args),
  };
});

const { GET, POST } = await import("../environments/route");
const { DELETE } = await import("../environments/[envId]/route");

const ENV_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";

function environment() {
  return {
    id: ENV_ID,
    tenantId: "tenant_pat",
    name: "cloud",
    description: "hidden",
    type: "cloud",
    config: { type: "cloud", sandbox_backend: "docker", image: null, egress_allow_domains: [], idle_ttl_seconds: 3600 },
    status: "active",
    createdBy: "user_pat",
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
  };
}

function authed(url: string, scopes: string[], init?: RequestInit) {
  verifyPatMock.mockResolvedValue({
    id: 7,
    tenantId: "tenant_pat",
    userId: "user_pat",
    deptId: null,
    scopes,
    status: "active",
  });
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer agx-pat-test");
  return new Request(url, { ...init, headers });
}

describe("public ma environment routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    listMaEnvironmentsMock.mockReset();
    createMaEnvironmentMock.mockReset();
    getMaEnvironmentMock.mockReset();
    updateMaEnvironmentMock.mockReset();
    deleteMaEnvironmentMock.mockReset();
  });

  it("GET requires ma:environments:read", async () => {
    const missing = await GET(new Request("http://localhost/api/ma/v1/environments"));
    expect(missing.status).toBe(401);
    const forbidden = await GET(authed("http://localhost/api/ma/v1/environments", ["ma:agents:read"]));
    expect(forbidden.status).toBe(403);
    const body = (await forbidden.json()) as { error: { details?: { required?: string } } };
    expect(body.error.details?.required).toBe("ma:environments:read");
  });

  it("POST requires ma:environments:write and returns 201", async () => {
    createMaEnvironmentMock.mockResolvedValue(environment());
    const forbidden = await POST(
      authed("http://localhost/api/ma/v1/environments", ["ma:environments:read"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "cloud", type: "cloud" }),
      }),
    );
    expect(forbidden.status).toBe(403);
    const response = await POST(
      authed("http://localhost/api/ma/v1/environments", ["ma:environments:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "cloud", type: "cloud" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(createMaEnvironmentMock).toHaveBeenCalledWith(
      "tenant_pat",
      expect.objectContaining({ name: "cloud", type: "cloud" }),
      "user_pat",
    );
  });

  it("records omit description", async () => {
    listMaEnvironmentsMock.mockResolvedValue([environment()]);
    const response = await GET(authed("http://localhost/api/ma/v1/environments", ["ma:environments:read"]));
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    const first = body.data[0];
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {}).sort()).toEqual(["config", "id", "name", "status", "tenant_id", "type"].sort());
    expect(first).not.toHaveProperty("description");
  });

  it("DELETE returns deleted true", async () => {
    deleteMaEnvironmentMock.mockResolvedValue(undefined);
    const response = await DELETE(authed(`http://localhost/api/ma/v1/environments/${ENV_ID}`, ["ma:environments:write"], { method: "DELETE" }), {
      params: Promise.resolve({ envId: ENV_ID }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; deleted: boolean };
    expect(body).toEqual({ id: ENV_ID, deleted: true });
  });

  it("DELETE maps in-use to 409 environment_in_use", async () => {
    const { MaEnvironmentInUseError } = await import("@agenticx/iam-core");
    deleteMaEnvironmentMock.mockRejectedValue(new MaEnvironmentInUseError());
    const response = await DELETE(authed(`http://localhost/api/ma/v1/environments/${ENV_ID}`, ["ma:environments:write"], { method: "DELETE" }), {
      params: Promise.resolve({ envId: ENV_ID }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("environment_in_use");
  });
});

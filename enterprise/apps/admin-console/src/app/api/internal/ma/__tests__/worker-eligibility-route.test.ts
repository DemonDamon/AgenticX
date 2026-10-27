import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const getAdminUserMock = vi.fn();
const listMaEnvironmentsMock = vi.fn();
const resolveAssignmentKeysForUserMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  getAdminUser: (...args: unknown[]) => getAdminUserMock(...args),
  listMaEnvironments: (...args: unknown[]) => listMaEnvironmentsMock(...args),
  resolveAssignmentKeysForUser: (...args: unknown[]) => resolveAssignmentKeysForUserMock(...args),
}));

const { GET } = await import("../worker-eligibility/route");

const TENANT = "01J00000000000000000000001";
const USER = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function withToken(url: string, token = "ma-token") { // gitleaks:allow
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

function env(id: string, workerKeys: string[]) {
  return {
    id,
    tenantId: TENANT,
    name: id,
    description: null,
    type: "desktop_worker" as const,
    config: { type: "desktop_worker" as const, worker_keys: workerKeys },
    status: "active" as const,
    createdBy: null,
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
  };
}

describe("worker eligibility route", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "");
    getAdminUserMock.mockReset();
    listMaEnvironmentsMock.mockReset();
    resolveAssignmentKeysForUserMock.mockReset();
  });

  it("returns 401 without internal token", async () => {
    const response = await GET(
      new Request(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=${TENANT}&user_id=${USER}`),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toBe("invalid internal token");
  });

  it("rejects bad tenant_id", async () => {
    const response = await GET(
      withToken(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=bad tenant&user_id=${USER}`),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBe("tenant_id is required");
  });

  it("rejects non-ULID user_id", async () => {
    const response = await GET(
      withToken(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=${TENANT}&user_id=user_1`),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBe("user_id is required");
  });

  it("returns empty for disabled user", async () => {
    getAdminUserMock.mockResolvedValue({ status: "disabled" });
    const response = await GET(
      withToken(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=${TENANT}&user_id=${USER}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user_id: USER, assignment_keys: [], environments: [] });
    expect(resolveAssignmentKeysForUserMock).not.toHaveBeenCalled();
  });

  it("filters environments by worker_keys intersection", async () => {
    getAdminUserMock.mockResolvedValue({
      id: USER,
      email: "a@x.com",
      deptId: "D1",
      status: "active",
    });
    resolveAssignmentKeysForUserMock.mockResolvedValue(["all", "U1", "dept:D1"]);
    listMaEnvironmentsMock.mockResolvedValue([
      env("E1", ["dept:D1"]),
      env("E2", ["dept:D2"]),
      env("E3", []),
    ]);
    const response = await GET(
      withToken(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=${TENANT}&user_id=${USER}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      assignment_keys: string[];
      environments: Array<Record<string, unknown>>;
    };
    expect(body.assignment_keys).toEqual(["all", "U1", "dept:D1"]);
    expect(body.environments).toHaveLength(1);
    expect(body.environments[0]?.id).toBe("E1");
    expect(Object.keys(body.environments[0] ?? {}).sort()).toEqual([
      "config",
      "id",
      "name",
      "status",
      "tenant_id",
      "type",
    ]);
  });

  it("queries only active desktop_worker environments", async () => {
    getAdminUserMock.mockResolvedValue({ id: USER, email: "a@x.com", deptId: null, status: "active" });
    resolveAssignmentKeysForUserMock.mockResolvedValue(["all"]);
    listMaEnvironmentsMock.mockResolvedValue([]);
    await GET(withToken(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=${TENANT}&user_id=${USER}`));
    expect(listMaEnvironmentsMock).toHaveBeenCalledWith(TENANT, { type: "desktop_worker", status: "active" });
  });

  it("sets cache-control no-store", async () => {
    getAdminUserMock.mockResolvedValue({ status: "disabled" });
    const response = await GET(
      withToken(`http://localhost/api/internal/ma/worker-eligibility?tenant_id=${TENANT}&user_id=${USER}`),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

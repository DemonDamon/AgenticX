import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const createMemoryStoreMock = vi.fn();
const listMemoryStoresMock = vi.fn();
const applyMemoryWriteMock = vi.fn();
const listMemoriesMock = vi.fn();
const getMemoryMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  verifyPat: (...args: unknown[]) => verifyPatMock(...args),
  touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
  createMemoryStore: (...args: unknown[]) => createMemoryStoreMock(...args),
  listMemoryStores: (...args: unknown[]) => listMemoryStoresMock(...args),
  applyMemoryWrite: (...args: unknown[]) => applyMemoryWriteMock(...args),
  listMemories: (...args: unknown[]) => listMemoriesMock(...args),
  getMemory: (...args: unknown[]) => getMemoryMock(...args),
}));

const { POST: createStore } = await import("../memory_stores/route");
const { POST: createMemory, GET: listRoute } = await import("../memory_stores/[storeId]/memories/route");
const { PATCH } = await import("../memory_stores/[storeId]/memories/[memoryId]/route");

const STORE = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const MEMORY = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

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

function memory(content = "周报用中文") {
  return {
    id: MEMORY,
    tenantId: "tenant_pat",
    storeId: STORE,
    path: "/preferences/report.md",
    contentSha256: "ab".repeat(32),
    sizeBytes: Buffer.byteLength(content),
    version: 1,
    lastActorKind: "user" as const,
    lastActorUserId: "user_pat",
    lastSessionId: null,
    createdAt: "2026-10-25T08:00:00.000Z",
    updatedAt: "2026-10-25T08:00:00.000Z",
    content,
  };
}

function named(name: string, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(name), { name, ...extra });
}

describe("public memory store routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    createMemoryStoreMock.mockReset();
    listMemoryStoresMock.mockReset();
    applyMemoryWriteMock.mockReset();
    listMemoriesMock.mockReset();
    getMemoryMock.mockReset();
  });

  it("rejects a read-only PAT on POST", async () => {
    const response = await createStore(
      authed("http://localhost/api/ma/v1/memory_stores", ["ma:memory:read"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "W4" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden_scope");
  });

  it("returns created memory content", async () => {
    applyMemoryWriteMock.mockResolvedValue({ ok: true, memory: memory(), version: 1 });
    const response = await createMemory(
      authed(`http://localhost/api/ma/v1/memory_stores/${STORE}/memories`, ["ma:memory:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "/preferences/report.md", content: "周报用中文" }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { memory: { content?: string } };
    expect(body.memory.content).toBe("周报用中文");
  });

  it("requires a version precondition on PATCH", async () => {
    const response = await PATCH(
      authed(`http://localhost/api/ma/v1/memory_stores/${STORE}/memories/${MEMORY}`, ["ma:memory:write"], {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "next" }),
      }),
      { params: Promise.resolve({ storeId: STORE, memoryId: MEMORY }) },
    );
    expect(response.status).toBe(400);
    expect(applyMemoryWriteMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the content hash precondition does not match", async () => {
    getMemoryMock.mockResolvedValue(memory());
    const response = await PATCH(
      authed(`http://localhost/api/ma/v1/memory_stores/${STORE}/memories/${MEMORY}`, ["ma:memory:write"], {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "next", precondition: { type: "content_sha256", content_sha256: "f".repeat(64) } }),
      }),
      { params: Promise.resolve({ storeId: STORE, memoryId: MEMORY }) },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; details?: { current?: { version: number } } } };
    expect(body.error.code).toBe("memory_version_conflict");
    expect(body.error.details?.current?.version).toBe(1);
    expect(applyMemoryWriteMock).not.toHaveBeenCalled();
  });

  it("rejects view=full with limit 50", async () => {
    const response = await listRoute(
      authed(`http://localhost/api/ma/v1/memory_stores/${STORE}/memories?view=full&limit=50`, ["ma:memory:read"]),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(response.status).toBe(400);
    expect(listMemoriesMock).not.toHaveBeenCalled();
  });

  it("maps memory error classes to control-plane codes", async () => {
    const cases: Array<{ name: string; status: number; code: string; extra?: Record<string, unknown> }> = [
      { name: "MaMemoryValidationError", status: 400, code: "invalid_request" },
      { name: "MaMemoryStoreNotFoundError", status: 404, code: "memory_store_not_found" },
      { name: "MaMemoryNotFoundError", status: 404, code: "memory_not_found" },
      {
        name: "MaMemoryVersionConflictError",
        status: 409,
        code: "memory_version_conflict",
        extra: { current: { id: MEMORY, path: "/a.md", version: 2, contentSha256: "ab" } },
      },
      { name: "MaMemoryPathConflictError", status: 409, code: "memory_path_conflict", extra: { conflictingPath: "/a" } },
      { name: "MaMemoryStoreArchivedError", status: 409, code: "memory_store_archived" },
      { name: "MaMemoryStoreNotArchivedError", status: 409, code: "memory_store_not_archived" },
      { name: "MaMemoryStoreInUseError", status: 409, code: "memory_store_in_use" },
      { name: "MaMemoryVersionIsHeadError", status: 409, code: "memory_version_is_head" },
      { name: "MaMemoryStoreLimitError", status: 409, code: "memory_store_limit" },
    ];
    for (const entry of cases) {
      createMemoryStoreMock.mockRejectedValueOnce(named(entry.name, entry.extra));
      const response = await createStore(
        authed("http://localhost/api/ma/v1/memory_stores", ["ma:memory:write"], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "W4" }),
        }),
      );
      expect(response.status, entry.name).toBe(entry.status);
      const body = (await response.json()) as { error: { code: string; details?: { conflicting_path?: string; current?: { content_sha256?: string } } } };
      expect(body.error.code, entry.name).toBe(entry.code);
      if (entry.name === "MaMemoryPathConflictError") expect(body.error.details?.conflicting_path).toBe("/a");
      if (entry.name === "MaMemoryVersionConflictError") expect(body.error.details?.current?.content_sha256).toBe("ab");
    }
  });
});

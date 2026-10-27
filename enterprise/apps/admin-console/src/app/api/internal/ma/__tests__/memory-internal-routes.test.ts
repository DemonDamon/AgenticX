import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const validateMemoryStoreIdsMock = vi.fn();
const getMaSessionMock = vi.fn();
const snapshotMemoryStoreMock = vi.fn();
const applyMemoryWriteMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  validateMemoryStoreIds: (...args: unknown[]) => validateMemoryStoreIdsMock(...args),
  getMaSession: (...args: unknown[]) => getMaSessionMock(...args),
  snapshotMemoryStore: (...args: unknown[]) => snapshotMemoryStoreMock(...args),
  applyMemoryWrite: (...args: unknown[]) => applyMemoryWriteMock(...args),
}));

const { POST: validate } = await import("../memory-stores/validate/route");
const { GET: snapshot } = await import("../memory-stores/[storeId]/snapshot/route");
const { POST: writes } = await import("../memory-stores/[storeId]/writes/route");

const TENANT = "tenant_test";
const SESSION = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const STORE = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const MEMORY = "01C23456789ABCDEFGHJKMNPQR";

function withToken(url: string, init?: RequestInit, token = "ma-token") { // gitleaks:allow
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...init, headers });
}

function session(access: "read_write" | "read_only" | "missing") {
  return {
    id: SESSION,
    status: "idle",
    archivedAt: null,
    createdByUserId: "user_1",
    resources:
      access === "missing"
        ? []
        : [{ type: "memory_store", memory_store_id: STORE, access }],
  };
}

describe("internal memory routes", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("MA_MEMORY_INTERNAL_ENABLED", "1");
    validateMemoryStoreIdsMock.mockReset();
    getMaSessionMock.mockReset();
    snapshotMemoryStoreMock.mockReset();
    applyMemoryWriteMock.mockReset();
  });

  it("requires the internal token and checks the mount", async () => {
    const missing = await snapshot(new Request(`http://localhost/api/internal/ma/memory-stores/${STORE}/snapshot?tenant_id=${TENANT}&session_id=${SESSION}`), {
      params: Promise.resolve({ storeId: STORE }),
    });
    expect(missing.status).toBe(401);

    getMaSessionMock.mockResolvedValueOnce(null);
    const absent = await snapshot(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/snapshot?tenant_id=${TENANT}&session_id=${SESSION}`),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(absent.status).toBe(404);
    expect(((await absent.json()) as { error: { code: string } }).error.code).toBe("session_not_found");

    getMaSessionMock.mockResolvedValueOnce(session("missing"));
    const unmounted = await snapshot(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/snapshot?tenant_id=${TENANT}&session_id=${SESSION}`),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(unmounted.status).toBe(403);
    expect(((await unmounted.json()) as { error: { message: string } }).error.message).toBe("session does not mount this memory store");

    getMaSessionMock.mockResolvedValueOnce(session("read_only"));
    const denied = await writes(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/writes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: TENANT, session_id: SESSION, ops: [{ op: "create", path: "/a.md", content: "x" }] }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { message: string } }).error.message).toBe("memory store is mounted read_only");

    getMaSessionMock.mockResolvedValueOnce(session("read_only"));
    snapshotMemoryStoreMock.mockResolvedValue({
      store: { id: STORE, name: "项目知识", status: "active" },
      memories: [],
    });
    const readable = await snapshot(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/snapshot?tenant_id=${TENANT}&session_id=${SESSION}`),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(readable.status).toBe(200);

    vi.stubEnv("MA_MEMORY_INTERNAL_ENABLED", "0");
    const disabled = await validate(
      withToken("http://localhost/api/internal/ma/memory-stores/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: TENANT, memory_store_ids: [STORE] }),
      }),
    );
    expect(disabled.status).toBe(503);
  });

  it("returns one result per op and rejects 51 ops", async () => {
    getMaSessionMock.mockResolvedValue(session("read_write"));
    applyMemoryWriteMock.mockImplementation(async (_tenant: string, _store: string, op: { op: string }) => {
      if (op.op === "update") {
        return {
          ok: false,
          code: "memory_version_conflict",
          message: "memory has been modified",
          current: { id: MEMORY, path: "/notes/b.md", version: 4, contentSha256: "cd" },
        };
      }
      if (op.op === "delete") return { ok: true, memory: null, version: 3 };
      return {
        ok: true,
        version: 1,
        memory: { id: MEMORY, path: "/notes/a.md", version: 1, contentSha256: "ab", storeId: STORE, tenantId: TENANT, sizeBytes: 1, lastActorKind: "agent", lastActorUserId: "user_1", lastSessionId: SESSION, createdAt: "", updatedAt: "" },
      };
    });
    const response = await writes(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/writes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: TENANT,
          session_id: SESSION,
          ops: [
            { op: "create", path: "/notes/a.md", content: "..." },
            { op: "update", memory_id: MEMORY, expected_version: 3, content: "..." },
            { op: "delete", memory_id: MEMORY, expected_version: 2 },
          ],
        }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ ok: boolean; code?: string }> };
    expect(body.results).toHaveLength(3);
    expect(body.results[1]?.ok).toBe(false);
    expect(body.results[1]?.code).toBe("memory_version_conflict");
    expect(body.results[0]?.ok).toBe(true);
    expect(body.results[2]?.ok).toBe(true);
    expect(applyMemoryWriteMock).toHaveBeenCalledWith(
      TENANT,
      STORE,
      expect.objectContaining({ op: "create" }),
      { kind: "agent", userId: "user_1", sessionId: SESSION },
    );

    const tooMany = await writes(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/writes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: TENANT,
          session_id: SESSION,
          ops: Array.from({ length: 51 }, () => ({ op: "create", path: "/a.md", content: "x" })),
        }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(tooMany.status).toBe(400);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const exportMemoryStoreForDreamMock = vi.fn();
const createDreamOutputStoreMock = vi.fn();
const finishDreamOutputStoreMock = vi.fn();

function dreamOutputMetadata(dreamId: string, inputStoreId: string) {
  return {
    "agx.origin": "dream",
    "agx.dream_id": dreamId,
    "agx.review": "running",
    "agx.dream_input": inputStoreId,
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => {
  class MaMemoryStoreLimitError extends Error {
    constructor() {
      super("limit");
      this.name = "MaMemoryStoreLimitError";
    }
  }
  class MaMemoryStoreNotFoundError extends Error {
    constructor() {
      super("missing");
      this.name = "MaMemoryStoreNotFoundError";
    }
  }
  class MaMemoryValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MaMemoryValidationError";
    }
  }
  return {
    MaMemoryStoreLimitError,
    MaMemoryStoreNotFoundError,
    MaMemoryValidationError,
    getMaSession: vi.fn(),
    dreamOutputMetadata,
    exportMemoryStoreForDream: (...args: unknown[]) => exportMemoryStoreForDreamMock(...args),
    createDreamOutputStore: (...args: unknown[]) => createDreamOutputStoreMock(...args),
    finishDreamOutputStore: (...args: unknown[]) => finishDreamOutputStoreMock(...args),
  };
});

const { GET: exportStore } = await import("../memory-stores/[storeId]/export/route");
const { POST: createOutput } = await import("../memory-stores/dream-output/route");
const { POST: finishOutput } = await import("../memory-stores/[storeId]/dream-finish/route");

const TENANT = "tenant_test";
const STORE = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const OUTPUT = "01C23456789ABCDEFGHJKMNPQR";
const DREAM = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function withToken(url: string, init?: RequestInit, token = "ma-token") { // gitleaks:allow
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...init, headers });
}

function storeRecord(metadata: Record<string, string>) {
  return {
    id: OUTPUT,
    tenantId: TENANT,
    name: "整理",
    description: null,
    metadata,
    status: "active" as const,
    memoryCount: 0,
    totalBytes: 0,
    createdBy: "user_1",
    archivedAt: null,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
  };
}

describe("internal memory dream routes", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("MA_MEMORY_INTERNAL_ENABLED", "1");
    exportMemoryStoreForDreamMock.mockReset();
    createDreamOutputStoreMock.mockReset();
    finishDreamOutputStoreMock.mockReset();
  });

  it("requires a token and maps an oversized export to memory_store_limit", async () => {
    const missing = await exportStore(new Request(`http://localhost/api/internal/ma/memory-stores/${STORE}/export?tenant_id=${TENANT}`), {
      params: Promise.resolve({ storeId: STORE }),
    });
    expect(missing.status).toBe(401);

    const error = new Error("limit");
    error.name = "MaMemoryStoreLimitError";
    exportMemoryStoreForDreamMock.mockRejectedValueOnce(error);
    const limited = await exportStore(
      withToken(`http://localhost/api/internal/ma/memory-stores/${STORE}/export?tenant_id=${TENANT}`),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(limited.status).toBe(409);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("memory_store_limit");
  });

  it("creates a dream output store with the four origin metadata keys", async () => {
    const metadata = dreamOutputMetadata(DREAM, STORE);
    createDreamOutputStoreMock.mockResolvedValueOnce(storeRecord(metadata));
    const response = await createOutput(
      withToken("http://localhost/api/internal/ma/memory-stores/dream-output", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: TENANT,
          input_memory_store_id: STORE,
          name: "整理",
          dream_id: DREAM,
          created_by_user_id: "user_1",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(createDreamOutputStoreMock).toHaveBeenCalledWith(TENANT, {
      inputStoreId: STORE,
      name: "整理",
      description: null,
      dreamId: DREAM,
      createdBy: "user_1",
      metadata,
    });
    expect(metadata).toEqual({
      "agx.origin": "dream",
      "agx.dream_id": DREAM,
      "agx.review": "running",
      "agx.dream_input": STORE,
    });
  });

  it("rejects a mismatched dream finish and imports a completed result", async () => {
    const missing = new Error("missing");
    missing.name = "MaMemoryStoreNotFoundError";
    finishDreamOutputStoreMock.mockRejectedValueOnce(missing);
    const mismatched = await finishOutput(
      withToken(`http://localhost/api/internal/ma/memory-stores/${OUTPUT}/dream-finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: TENANT,
          dream_id: DREAM,
          outcome: "completed",
          memories: [{ path: "/a.md", content: "tea" }],
          actor_user_id: "user_1",
        }),
      }),
      { params: Promise.resolve({ storeId: OUTPUT }) },
    );
    expect(mismatched.status).toBe(404);
    expect(((await mismatched.json()) as { error: { code: string } }).error.code).toBe("memory_store_not_found");

    finishDreamOutputStoreMock.mockResolvedValueOnce(storeRecord({ "agx.review": "pending" }));
    const completed = await finishOutput(
      withToken(`http://localhost/api/internal/ma/memory-stores/${OUTPUT}/dream-finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: TENANT,
          dream_id: DREAM,
          outcome: "completed",
          memories: [{ path: "/a.md", content: "tea" }],
          actor_user_id: "user_1",
        }),
      }),
      { params: Promise.resolve({ storeId: OUTPUT }) },
    );
    expect(completed.status).toBe(200);
    expect(finishDreamOutputStoreMock).toHaveBeenLastCalledWith(TENANT, OUTPUT, {
      dreamId: DREAM,
      outcome: "completed",
      memories: [{ path: "/a.md", content: "tea" }],
      actorUserId: "user_1",
    });
  });
});

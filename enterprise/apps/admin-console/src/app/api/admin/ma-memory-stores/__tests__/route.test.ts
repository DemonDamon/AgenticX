import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const createMemoryStoreMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("@agenticx/iam-core", () => {
  class MaMemoryVersionConflictError extends Error {
    constructor() {
      super("conflict");
      this.name = "MaMemoryVersionConflictError";
    }
  }
  return {
    MaMemoryVersionConflictError,
    MaMemoryValidationError: class MaMemoryValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "MaMemoryValidationError";
      }
    },
    createMemoryStore: (...args: unknown[]) => createMemoryStoreMock(...args),
    listMemoryStores: vi.fn(),
  };
});

const { POST } = await import("../route");

describe("admin memory store routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    createMemoryStoreMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("returns 403 when kb:update is missing", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const response = await POST(new Request("http://localhost/api/admin/ma-memory-stores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "W4" }),
    }));
    expect(response.status).toBe(403);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["kb:update"]);
  });

  it("creates a store and maps version conflicts to Chinese", async () => {
    createMemoryStoreMock.mockResolvedValueOnce({
      id: "01BX5ZZKBKACTAV9WEVGEMMVSX",
      tenantId: "tenant_test",
      name: "W4 记忆",
      description: null,
      metadata: {},
      status: "active",
      memoryCount: 0,
      totalBytes: 0,
      createdBy: "user_1",
      archivedAt: null,
      createdAt: "2026-10-25T08:00:00.000Z",
      updatedAt: "2026-10-25T08:00:00.000Z",
    });
    const created = await POST(new Request("http://localhost/api/admin/ma-memory-stores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "W4 记忆" }),
    }));
    expect(created.status).toBe(200);
    const body = (await created.json()) as { code: string; data: { memory_store: { name: string } } };
    expect(body.code).toBe("00000");
    expect(body.data.memory_store.name).toBe("W4 记忆");

    const conflictError = new Error("conflict");
    conflictError.name = "MaMemoryVersionConflictError";
    createMemoryStoreMock.mockRejectedValueOnce(conflictError);
    const conflict = await POST(new Request("http://localhost/api/admin/ma-memory-stores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "W4 记忆" }),
    }));
    expect(conflict.status).toBe(409);
    const errorBody = (await conflict.json()) as { message: string };
    expect(errorBody.message).toBe("该记忆已被其他会话或管理员修改，请刷新后再编辑");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const runtimeInternalMock = vi.fn();
const setDreamReviewDecisionMock = vi.fn();
const listMemoryDreamsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../lib/ma/runtime-internal-client", () => {
  class MaRuntimeUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MaRuntimeUnavailableError";
    }
  }
  class MaRuntimeRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "MaRuntimeRequestError";
    }
  }
  return {
    MaRuntimeUnavailableError,
    MaRuntimeRequestError,
    runtimeInternal: (...args: unknown[]) => runtimeInternalMock(...args),
  };
});
vi.mock("@agenticx/iam-core", () => {
  class MaMemoryValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MaMemoryValidationError";
    }
  }
  return {
    MaMemoryValidationError,
    listMemoryDreams: (...args: unknown[]) => listMemoryDreamsMock(...args),
    setDreamReviewDecision: (...args: unknown[]) => setDreamReviewDecisionMock(...args),
  };
});

const { POST } = await import("../[storeId]/dreams/route");
const { POST: review } = await import("../[storeId]/review/route");
const { MaRuntimeUnavailableError } = await import("../../../../../lib/ma/runtime-internal-client");

const STORE = "01BX5ZZKBKACTAV9WEVGEMMVSX";

describe("admin memory dream routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    runtimeInternalMock.mockReset();
    setDreamReviewDecisionMock.mockReset();
    listMemoryDreamsMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("posts the input store and the requesting admin to the runtime", async () => {
    runtimeInternalMock.mockResolvedValueOnce({ memory_dream: { id: "dream" } });
    const response = await POST(
      new Request(`http://localhost/api/admin/ma-memory-stores/${STORE}/dreams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_ids: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"],
          instructions: "按主题整理",
          model: "zhipu/glm-5",
          output_memory_store_name: "项目知识-整理-20261025",
        }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(response.status).toBe(200);
    expect(runtimeInternalMock).toHaveBeenCalledWith("POST", "/internal/ma/memory-dreams", {
      tenant_id: "tenant_test",
      created_by_user_id: "user_1",
      input_memory_store_id: STORE,
      session_ids: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"],
      instructions: "按主题整理",
      model: "zhipu/glm-5",
      output_memory_store_name: "项目知识-整理-20261025",
    });
  });

  it("returns the unavailable copy when the runtime cannot be reached", async () => {
    runtimeInternalMock.mockRejectedValueOnce(new MaRuntimeUnavailableError("评测运行时不可达"));
    const response = await POST(
      new Request(`http://localhost/api/admin/ma-memory-stores/${STORE}/dreams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_ids: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"],
          instructions: "按主题整理",
          model: "zhipu/glm-5",
          output_memory_store_name: "整理",
        }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe("记忆整理服务不可达，请确认 agent-runtime 已启动并开启该功能");
  });

  it("rejects a review when the store is not awaiting review", async () => {
    const error = new Error("memory store is not awaiting review");
    error.name = "MaMemoryValidationError";
    setDreamReviewDecisionMock.mockRejectedValueOnce(error);
    const response = await review(
      new Request(`http://localhost/api/admin/ma-memory-stores/${STORE}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ storeId: STORE }) },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe("该记忆库不在待审核状态");
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["kb:update"]);
  });
});

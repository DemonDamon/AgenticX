import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const runtimeInternalMock = vi.fn();

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

const { GET } = await import("../[webhookId]/deliveries/route");
const { MaRuntimeRequestError, MaRuntimeUnavailableError } = await import("../../../../../lib/ma/runtime-internal-client");

const WEBHOOK_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const delivery = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
  webhook_id: WEBHOOK_ID,
  event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
  event_type: "environment.created",
  status: "succeeded",
  attempts: 1,
  next_attempt_at: "2026-10-26T01:00:00.000Z",
  last_status_code: 204,
  last_error: null,
  delivered_at: "2026-10-26T01:00:01.000Z",
  created_at: "2026-10-26T01:00:00.000Z",
  payload: { marker: "secret-payload" },
  event_key: "environment.created:01ARZ3NDEKTSV4RRFFQ69G5FB1",
  tenant_id: "tenant_test",
};

describe("admin webhook deliveries", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    runtimeInternalMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("passes runtime delivery records through and drops payload", async () => {
    runtimeInternalMock.mockResolvedValueOnce({ data: [delivery] });
    const response = await GET(
      new Request(`http://localhost/api/admin/ma-webhooks/${WEBHOOK_ID}/deliveries?limit=10`),
      { params: Promise.resolve({ webhookId: WEBHOOK_ID }) },
    );
    expect(response.status).toBe(200);
    expect(runtimeInternalMock).toHaveBeenCalledWith(
      "GET",
      `/internal/ma/webhooks/${WEBHOOK_ID}/deliveries?tenant_id=tenant_test&limit=10`,
    );
    const json = (await response.json()) as { code: string; data: { deliveries: Array<Record<string, unknown>> } };
    expect(json.code).toBe("00000");
    expect(json.data.deliveries).toEqual([
      {
        id: delivery.id,
        webhook_id: delivery.webhook_id,
        event_id: delivery.event_id,
        event_type: delivery.event_type,
        status: delivery.status,
        attempts: delivery.attempts,
        next_attempt_at: delivery.next_attempt_at,
        last_status_code: delivery.last_status_code,
        last_error: delivery.last_error,
        delivered_at: delivery.delivered_at,
        created_at: delivery.created_at,
      },
    ]);
    expect(json.data.deliveries[0]).not.toHaveProperty("payload");
    expect(json.data.deliveries[0]).not.toHaveProperty("event_key");
  });

  it("returns 503 when the runtime is unreachable", async () => {
    runtimeInternalMock.mockRejectedValueOnce(new MaRuntimeUnavailableError("评测运行时不可达"));
    const response = await GET(new Request(`http://localhost/api/admin/ma-webhooks/${WEBHOOK_ID}/deliveries`), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "50300", message: "运行时不可达，暂时无法读取投递记录" });
  });

  it("maps a runtime request error onto its status", async () => {
    runtimeInternalMock.mockRejectedValueOnce(new MaRuntimeRequestError(404, "not_found", "missing"));
    const response = await GET(new Request(`http://localhost/api/admin/ma-webhooks/${WEBHOOK_ID}/deliveries`), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "40400", message: "missing" });
  });
});

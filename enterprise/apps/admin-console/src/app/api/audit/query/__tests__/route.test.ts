import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSomeScopeMock = vi.fn();
const buildAuditActorMock = vi.fn();
const queryAuditMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminSomeScope: (...args: unknown[]) => requireAdminSomeScopeMock(...args),
}));

vi.mock("../../../../../lib/audit-service", () => ({
  buildAuditActor: (...args: unknown[]) => buildAuditActorMock(...args),
  queryAudit: (...args: unknown[]) => queryAuditMock(...args),
}));

describe("POST /api/audit/query trace filters", () => {
  beforeEach(() => {
    requireAdminSomeScopeMock.mockReset();
    buildAuditActorMock.mockReset();
    queryAuditMock.mockReset();
  });

  it("forwards a valid trace_id into queryAudit", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "t1", userId: "u1", email: "a@example.com" },
      scopes: ["audit:read:all"],
    });
    buildAuditActorMock.mockResolvedValue({
      tenantId: "t1",
      userId: "u1",
      scopes: ["audit:read:all"],
    });
    queryAuditMock.mockResolvedValue({
      code: "00000",
      message: "ok",
      data: { total: 0, items: [], chain_valid: true },
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/audit/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace_id: " 01JTRACEAAAAAAAAAAAAAAAAA " }),
      }),
    );

    expect(response.status).toBe(200);
    expect(queryAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1" }),
      expect.objectContaining({
        tenant_id: "t1",
        trace_id: "01JTRACEAAAAAAAAAAAAAAAAA",
      }),
    );
  });

  it("rejects trace_id longer than 128 chars with 400", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "t1", userId: "u1", email: "a@example.com" },
      scopes: ["audit:read:all"],
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/audit/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace_id: "x".repeat(129) }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "40001", message: "invalid trace_id" });
    expect(queryAuditMock).not.toHaveBeenCalled();
  });

  it("still rejects unauthenticated callers via requireAdminSomeScope", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ code: "40101", message: "unauthorized" }), {
        status: 401,
      }),
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/audit/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(queryAuditMock).not.toHaveBeenCalled();
  });
});

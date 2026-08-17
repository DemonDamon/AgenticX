import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSomeScopeMock = vi.fn();
const queryPortalLogSessionsMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminSomeScope: (...args: unknown[]) => requireAdminSomeScopeMock(...args),
}));

vi.mock("../../../../../lib/portal-logs-session-query", () => ({
  queryPortalLogSessions: (...args: unknown[]) => queryPortalLogSessionsMock(...args),
}));

vi.mock("../../../../../lib/portal-logs-query", async () => {
  const actual = await vi.importActual<typeof import("../../../../../lib/portal-logs-query")>(
    "../../../../../lib/portal-logs-query",
  );
  return {
    ...actual,
  };
});

describe("POST /api/portal-logs/sessions", () => {
  beforeEach(() => {
    requireAdminSomeScopeMock.mockReset();
    queryPortalLogSessionsMock.mockReset();
  });

  it("returns 403 when caller lacks audit scopes", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ code: "40300", message: "forbidden" }), {
        status: 403,
      }),
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/portal-logs/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(queryPortalLogSessionsMock).not.toHaveBeenCalled();
  });

  it("forwards mode, session_id, and time range to queryPortalLogSessions", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-alpha", userId: "u1", email: "a@example.com" },
      scopes: ["audit:read:all"],
    });
    queryPortalLogSessionsMock.mockResolvedValue({ total: 0, items: [], ungrouped_count: 0 });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/portal-logs/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          session_id: "sess-abc",
          start: "2026-08-01T00:00:00.000Z",
          end: "2026-08-11T00:00:00.000Z",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(queryPortalLogSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-alpha",
        mode: "chat",
        session_id: "sess-abc",
        start: "2026-08-01T00:00:00.000Z",
        end: "2026-08-11T00:00:00.000Z",
      }),
    );
  });

  it("rejects invalid JSON with 40001", async () => {
    requireAdminSomeScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "t1", userId: "u1", email: "a@example.com" },
      scopes: ["audit:read:all"],
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/portal-logs/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "40001", message: "invalid json" });
    expect(queryPortalLogSessionsMock).not.toHaveBeenCalled();
  });
});

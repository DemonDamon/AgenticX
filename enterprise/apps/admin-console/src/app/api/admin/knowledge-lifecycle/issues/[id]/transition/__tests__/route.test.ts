import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const transitionIssueMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../../../../lib/knowledge-lifecycle-store", () => ({
  transitionIssue: (...args: unknown[]) => transitionIssueMock(...args),
}));

describe("knowledge-lifecycle issue transition RBAC", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    transitionIssueMock.mockReset();
  });

  it("returns 403 when kb:update is missing", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/knowledge-lifecycle/issues/iss-1/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: "iss-1" }) },
    );
    expect(response.status).toBe(403);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["kb:update"]);
    expect(transitionIssueMock).not.toHaveBeenCalled();
  });

  it("resolves issue with session actor", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "resolver@agenticx.local", userId: "user_3", tenantId: "tenant_1" },
    });
    transitionIssueMock.mockResolvedValue({ id: "iss-1", status: "resolved" });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/knowledge-lifecycle/issues/iss-1/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: "iss-1" }) },
    );
    expect(response.status).toBe(200);
    expect(transitionIssueMock).toHaveBeenCalledWith("iss-1", "resolved", {
      actor: "resolver@agenticx.local",
    });
  });
});

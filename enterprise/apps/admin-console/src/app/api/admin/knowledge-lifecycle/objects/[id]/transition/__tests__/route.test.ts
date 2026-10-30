import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const transitionObjectMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../../../../lib/knowledge-lifecycle-store", () => ({
  transitionObject: (...args: unknown[]) => transitionObjectMock(...args),
}));

describe("knowledge-lifecycle object transition RBAC", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    transitionObjectMock.mockReset();
  });

  it("returns 403 when kb:update is missing", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/knowledge-lifecycle/objects/device-sample-1/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "reviewed" }),
      }),
      { params: Promise.resolve({ id: "device-sample-1" }) },
    );
    expect(response.status).toBe(403);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["kb:update"]);
    expect(transitionObjectMock).not.toHaveBeenCalled();
  });

  it("transitions with session actor on happy path", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "reviewer@agenticx.local", userId: "user_1", tenantId: "tenant_1" },
      scopes: ["kb:update"],
    });
    transitionObjectMock.mockResolvedValue({
      id: "device-sample-1",
      status: "reviewed",
    });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/knowledge-lifecycle/objects/device-sample-1/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "reviewed" }),
      }),
      { params: Promise.resolve({ id: "device-sample-1" }) },
    );
    expect(response.status).toBe(200);
    expect(transitionObjectMock).toHaveBeenCalledWith("device-sample-1", "reviewed", {
      actor: "reviewer@agenticx.local",
    });
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("00000");
  });
});

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const runQualityMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../../lib/knowledge-lifecycle-store", () => ({
  runQualityAndOpenIssues: (...args: unknown[]) => runQualityMock(...args),
}));

describe("knowledge-lifecycle quality RBAC", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    runQualityMock.mockReset();
  });

  it("returns 403 when kb:update is missing", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const { POST } = await import("../route");
    const response = await POST();
    expect(response.status).toBe(403);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["kb:update"]);
    expect(runQualityMock).not.toHaveBeenCalled();
  });

  it("runs quality on authorized happy path", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "qa@agenticx.local", userId: "user_2", tenantId: "tenant_1" },
    });
    runQualityMock.mockResolvedValue({ findings: [], opened: [] });
    const { POST } = await import("../route");
    const response = await POST();
    expect(response.status).toBe(200);
    expect(runQualityMock).toHaveBeenCalled();
    const body = (await response.json()) as { code: string; data: { findings: unknown[] } };
    expect(body.code).toBe("00000");
    expect(body.data.findings).toEqual([]);
  });
});

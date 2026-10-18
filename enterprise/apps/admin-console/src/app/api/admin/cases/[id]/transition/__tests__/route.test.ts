import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const transitionMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  transitionEnterpriseCase: (...args: unknown[]) => transitionMock(...args),
  CaseNotFoundError: class CaseNotFoundError extends Error {},
  CaseTransitionError: class CaseTransitionError extends Error {},
}));

describe("admin case transition", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    transitionMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "user_1" },
    });
  });

  it("rejects a status that skips archive", async () => {
    const { CaseTransitionError } = await import("@agenticx/iam-core");
    transitionMock.mockRejectedValue(new CaseTransitionError("cannot move case from submitted to published"));
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/cases/case_1/transition", {
        method: "POST",
        body: JSON.stringify({ status: "published" }),
      }),
      { params: Promise.resolve({ id: "case_1" }) },
    );
    expect(response.status).toBe(400);
    expect(transitionMock).toHaveBeenCalledWith("tenant_1", "case_1", "published");
  });
});

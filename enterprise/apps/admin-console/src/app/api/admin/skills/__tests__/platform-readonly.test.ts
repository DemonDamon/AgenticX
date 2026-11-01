import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const updateSkillMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../lib/capability-packs-store", () => ({
  getSkill: vi.fn(async () => ({
    id: "sk1",
    origin: "platform",
    metadataReadOnly: true,
  })),
  updateSkill: (...args: unknown[]) => updateSkillMock(...args),
  deleteSkill: vi.fn(),
  PlatformSkillMetadataReadonlyError: class PlatformSkillMetadataReadonlyError extends Error {
    name = "PlatformSkillMetadataReadonlyError";
  },
}));

describe("admin skills PATCH platform readonly", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    updateSkillMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant_1" } });
  });

  it("returns 403 when store rejects platform metadata edits", async () => {
    const { PlatformSkillMetadataReadonlyError } = await import(
      "../../../../../lib/capability-packs-store"
    );
    updateSkillMock.mockRejectedValueOnce(new PlatformSkillMetadataReadonlyError());
    const { PATCH } = await import("../[id]/route");
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "hack" }),
      }),
      { params: Promise.resolve({ id: "sk1" }) },
    );
    expect(res.status).toBe(403);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listCapabilityPacksMock = vi.fn();
const createCapabilityPackMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../lib/capability-packs-store", () => ({
  listCapabilityPacks: (...args: unknown[]) => listCapabilityPacksMock(...args),
  createCapabilityPack: (...args: unknown[]) => createCapabilityPackMock(...args),
}));

describe("admin capability-packs route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listCapabilityPacksMock.mockReset();
    createCapabilityPackMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1" },
    });
  });

  it("GET returns 500 with a migrate hint when the table is missing", async () => {
    listCapabilityPacksMock.mockRejectedValue(
      new Error('relation "enterprise_capability_packs" does not exist'),
    );

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(500);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("50000");
    expect(body.message).toMatch(/db:migrate/);
  });

  it("GET does not return an empty success when persistence fails", async () => {
    listCapabilityPacksMock.mockRejectedValue(new Error("DATABASE_URL is not set"));

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).not.toBe(200);
    const body = (await response.json()) as { data?: { packs?: unknown[] } };
    expect(body.data?.packs).toBeUndefined();
  });

  it("GET seeds the baseline pack only when the tenant has none", async () => {
    listCapabilityPacksMock.mockResolvedValueOnce([]);
    createCapabilityPackMock.mockResolvedValue({ id: "p1" });
    listCapabilityPacksMock.mockResolvedValueOnce([
      { id: "p1", slug: "baseline-capabilities", capabilityIds: ["feature:web_search"] },
    ]);

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(createCapabilityPackMock).toHaveBeenCalledTimes(1);
    const input = createCapabilityPackMock.mock.calls[0]?.[0] as { capabilityIds: string[]; assignmentKeys: string[] };
    expect(input.capabilityIds).toEqual(["feature:web_search", "feature:deep_research"]);
    expect(input.assignmentKeys).toEqual(["all"]);
    const body = (await response.json()) as { data?: { packs?: Array<{ slug: string }> } };
    expect(body.data?.packs?.[0]?.slug).toBe("baseline-capabilities");
  });

  it("GET does not reseed when a pack already exists", async () => {
    listCapabilityPacksMock.mockResolvedValue([{ id: "p_existing", slug: "research" }]);

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(createCapabilityPackMock).not.toHaveBeenCalled();
  });

  it("GET still lists an empty result when seeding the baseline pack fails", async () => {
    listCapabilityPacksMock.mockResolvedValueOnce([]);
    createCapabilityPackMock.mockRejectedValue(new Error("unique slug"));

    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { packs?: unknown[] } };
    expect(body.data?.packs).toEqual([]);
  });
});

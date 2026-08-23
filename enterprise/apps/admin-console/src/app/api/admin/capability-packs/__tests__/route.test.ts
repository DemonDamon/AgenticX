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
});

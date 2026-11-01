import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../lib/platform-catalog-store", () => ({
  listCatalogItems: vi.fn(async () => [{ id: "cat1", slug: "s1" }]),
  createCatalogItem: vi.fn(async (input: { slug: string }) => ({ id: "cat1", ...input })),
  grantCatalogToTenant: vi.fn(async () => ({ grant: { status: "granted" }, skillId: "sk1" })),
  revokeCatalogFromTenant: vi.fn(async () => ({
    status: "revoked",
    revokePolicy: "retain_stop_updates",
  })),
}));

describe("admin platform-catalog routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant_1" } });
  });

  it("lists catalog items", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(1);
  });

  it("creates catalog item", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ slug: "demo" }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("grants to tenant", async () => {
    const { POST: grantPost } = await import("../[id]/grants/route");
    const res = await grantPost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ tenantId: "01TENANTAAAAAAAAAAAAAAAAAA" }),
      }),
      { params: Promise.resolve({ id: "cat1" }) },
    );
    expect(res.status).toBe(200);
  });

  it("revokes with default retain policy", async () => {
    const { DELETE: revokeDelete } = await import("../[id]/grants/route");
    const res = await revokeDelete(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ tenantId: "01TENANTAAAAAAAAAAAAAAAAAA" }),
      }),
      { params: Promise.resolve({ id: "cat1" }) },
    );
    expect(res.status).toBe(200);
  });
});

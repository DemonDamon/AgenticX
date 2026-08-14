import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScope = vi.fn();
const getPublicWebSearchConfig = vi.fn();
const upsertTenantWebSearchConfig = vi.fn();
const WebSearchConfigValidationError = vi.hoisted(
  () => class WebSearchConfigValidationError extends Error {},
);

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScope(...args),
}));

vi.mock("../../../../../../../web-portal/src/lib/web-search/tenant-config", () => ({
  getPublicWebSearchConfig: (...args: unknown[]) => getPublicWebSearchConfig(...args),
  upsertTenantWebSearchConfig: (...args: unknown[]) => upsertTenantWebSearchConfig(...args),
  WebSearchConfigValidationError,
}));

import { GET, PUT } from "../route";

function put(body: unknown): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/admin/web-search", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/admin/web-search", () => {
  beforeEach(() => {
    requireAdminScope.mockReset();
    getPublicWebSearchConfig.mockReset();
    upsertTenantWebSearchConfig.mockReset();
    requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1", userId: "admin-1" },
    });
  });

  it("loads tenant search configuration with read scope", async () => {
    getPublicWebSearchConfig.mockResolvedValue({ maxSearchCalls: 4 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(requireAdminScope).toHaveBeenCalledWith(["provider:read"]);
    expect(getPublicWebSearchConfig).toHaveBeenCalledWith("tenant-1");
  });

  it("persists the bounded per-turn search limit with update scope", async () => {
    upsertTenantWebSearchConfig.mockResolvedValue({ maxSearchCalls: 5 });

    const response = await put({ maxSearchCalls: 5 });

    expect(response.status).toBe(200);
    expect(requireAdminScope).toHaveBeenCalledWith(["provider:update"]);
    expect(upsertTenantWebSearchConfig).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ maxSearchCalls: 5 }),
    );
  });

  it.each([0, 6, 1.5, "3", null])(
    "rejects invalid search limits: %s",
    async (maxSearchCalls) => {
      const response = await put({ maxSearchCalls });
      expect(response.status).toBe(400);
      expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
    },
  );

  it("does not load configuration when the admin guard rejects access", async () => {
    requireAdminScope.mockResolvedValue({
      ok: false,
      response: Response.json({ code: "40300" }, { status: 403 }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(getPublicWebSearchConfig).not.toHaveBeenCalled();
  });
});

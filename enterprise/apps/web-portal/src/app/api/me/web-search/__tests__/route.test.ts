import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const getPublicWebSearchConfig = vi.fn();
const upsertTenantWebSearchConfig = vi.fn();

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
  passwordChangeRequiredResponse: () => Response.json(
    { code: "40302", message: "password_change_required" },
    { status: 403 },
  ),
}));

vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  getPublicWebSearchConfig: (...args: unknown[]) => getPublicWebSearchConfig(...args),
  upsertTenantWebSearchConfig: (...args: unknown[]) => upsertTenantWebSearchConfig(...args),
}));

import { GET, PUT } from "../route";

const SESSION = {
  tenantId: "tenant-1",
  userId: "user-1",
  mustChangePassword: false,
};

function put(body: unknown): Promise<Response> {
  return PUT(new Request("http://localhost/api/me/web-search", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("/api/me/web-search search-call budget", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset();
    getPublicWebSearchConfig.mockReset();
    upsertTenantWebSearchConfig.mockReset();
    getSessionFromCookies.mockResolvedValue(SESSION);
  });

  it("returns the persisted per-turn search limit", async () => {
    getPublicWebSearchConfig.mockResolvedValue({
      enabled: true,
      provider: "duckduckgo",
      maxResults: 50,
      maxSearchCalls: 4,
      hasApiKey: false,
      deepResearchEnabled: true,
      providers: [],
      availableAdapters: [],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { maxSearchCalls: 4 },
    });
    expect(getPublicWebSearchConfig).toHaveBeenCalledWith("tenant-1");
  });

  it.each([1, 5])("accepts a valid search limit of %i", async (maxSearchCalls) => {
    upsertTenantWebSearchConfig.mockResolvedValue({ maxSearchCalls });

    const response = await put({ maxSearchCalls });

    expect(response.status).toBe(200);
    expect(upsertTenantWebSearchConfig).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ maxSearchCalls }),
    );
  });

  it.each([0, 6, 1.5, "3", null])(
    "rejects an invalid search limit of %s",
    async (maxSearchCalls) => {
      const response = await put({ maxSearchCalls });

      expect(response.status).toBe(400);
      expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
    },
  );
});

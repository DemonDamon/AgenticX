import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const getPublicWebSearchConfig = vi.fn();
const upsertTenantWebSearchConfig = vi.fn();
const WebSearchConfigValidationError = vi.hoisted(
  () => class WebSearchConfigValidationError extends Error {},
);

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
  WebSearchConfigValidationError,
}));

import { GET, PUT } from "../route";

const SESSION = {
  tenantId: "tenant-1",
  userId: "user-1",
  mustChangePassword: false,
  scopes: ["provider:update"],
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

  it("allows members to read but rejects tenant-wide configuration writes", async () => {
    getSessionFromCookies.mockResolvedValue({ ...SESSION, scopes: ["workspace:chat"] });
    getPublicWebSearchConfig.mockResolvedValue({
      enabled: true,
      providers: [
        {
          id: "custom-1",
          adapter: "doubao",
          endpoint: "https://private-search.example/api",
        },
      ],
    });

    const getResponse = await GET();
    const putResponse = await put({ maxSearchCalls: 4 });

    expect(getResponse.status).toBe(200);
    const getJson = await getResponse.json();
    expect(getJson).toMatchObject({ data: { canManage: false } });
    expect(JSON.stringify(getJson)).not.toContain("private-search.example");
    expect(putResponse.status).toBe(403);
    expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
  });

  it("does not treat generic admin-console access as search-provider write access", async () => {
    getSessionFromCookies.mockResolvedValue({ ...SESSION, scopes: ["admin:enter"] });
    getPublicWebSearchConfig.mockResolvedValue({ enabled: true, providers: [] });

    const getResponse = await GET();
    const putResponse = await put({ maxSearchCalls: 4 });

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      data: { canManage: false },
    });
    expect(putResponse.status).toBe(403);
  });

  it("allows wildcard administrators to manage search providers", async () => {
    getSessionFromCookies.mockResolvedValue({ ...SESSION, scopes: ["*"] });
    upsertTenantWebSearchConfig.mockResolvedValue({ maxSearchCalls: 4 });

    const response = await put({ maxSearchCalls: 4 });

    expect(response.status).toBe(200);
  });

  it("returns tenant provider validation failures as a client error", async () => {
    upsertTenantWebSearchConfig.mockRejectedValue(
      new WebSearchConfigValidationError("搜索服务 API 地址无效"),
    );

    const response = await put({
      providers: [{ id: "custom-1", adapter: "doubao" }],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "搜索服务 API 地址无效" },
    });
  });

  it.each([0, 6, 1.5, "3", null])(
    "rejects an invalid search limit of %s",
    async (maxSearchCalls) => {
      const response = await put({ maxSearchCalls });

      expect(response.status).toBe(400);
      expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized top-level provider key", async () => {
    const response = await put({ apiKey: "k".repeat(8_193) });

    expect(response.status).toBe(400);
    expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
  });

  it("passes a bounded custom endpoint provider pool to the tenant config layer", async () => {
    upsertTenantWebSearchConfig.mockResolvedValue({ primaryProviderId: "custom-1" });

    const response = await put({
      providers: [
        {
          id: "custom-1",
          adapter: "doubao",
          displayName: "内部搜索",
          apiKey: "secret-key",
          enabled: true,
          priority: 0,
          options: { endpoint: "https://search.example/api" },
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(upsertTenantWebSearchConfig).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            id: "custom-1",
            adapter: "doubao",
            options: { endpoint: "https://search.example/api" },
          }),
        ],
      }),
    );
  });

  it.each([
    { providers: [] },
    {
      providers: [
        { id: "a", adapter: "bocha" },
        { id: "b", adapter: "tavily" },
        { id: "c", adapter: "doubao" },
      ],
    },
    { providers: [{ id: "a", adapter: "bocha", options: "bad" }] },
  ])("rejects an invalid provider pool %#", async (body) => {
    const response = await put(body);

    expect(response.status).toBe(400);
    expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const getPublicWebSearchConfig = vi.fn();

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
  passwordChangeRequiredResponse: () =>
    Response.json(
      { code: "40302", message: "password_change_required" },
      { status: 403 },
    ),
}));

vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  getPublicWebSearchConfig: (...args: unknown[]) => getPublicWebSearchConfig(...args),
}));

import { GET } from "../route";

const SESSION = {
  tenantId: "tenant-1",
  userId: "user-1",
  mustChangePassword: false,
  scopes: ["workspace:chat"],
};

describe("/api/me/web-search", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset();
    getPublicWebSearchConfig.mockReset();
    getSessionFromCookies.mockResolvedValue(SESSION);
  });

  it("returns the tenant policy needed by the chat composer", async () => {
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
      data: {
        enabled: true,
        deepResearchEnabled: true,
        maxSearchCalls: 4,
        canManage: false,
      },
    });
    expect(getPublicWebSearchConfig).toHaveBeenCalledWith("tenant-1");
  });

  it("never exposes provider endpoints or management capability on the portal", async () => {
    getSessionFromCookies.mockResolvedValue({
      ...SESSION,
      scopes: ["provider:update", "*"],
    });
    getPublicWebSearchConfig.mockResolvedValue({
      enabled: true,
      providers: [
        {
          id: "custom-1",
          adapter: "custom",
          endpoint: "https://private-search.example/api",
        },
      ],
      availableAdapters: [],
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ data: { canManage: false } });
    expect(JSON.stringify(payload)).not.toContain("private-search.example");
  });

  it("requires an authenticated portal session", async () => {
    getSessionFromCookies.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getPublicWebSearchConfig).not.toHaveBeenCalled();
  });
});

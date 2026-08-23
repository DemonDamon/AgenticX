import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const getPublicWebSearchConfig = vi.fn();
const isPlatformFeatureAllowedForUser = vi.fn();

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
}));

vi.mock("../../../../../lib/web-search/tenant-config", () => ({
  getPublicWebSearchConfig: (...args: unknown[]) => getPublicWebSearchConfig(...args),
  upsertTenantWebSearchConfig: vi.fn(),
}));

vi.mock("../../../../../lib/capability-packs-reader", () => ({
  isPlatformFeatureAllowedForUser: (...args: unknown[]) => isPlatformFeatureAllowedForUser(...args),
}));

const tenantConfig = {
  enabled: true,
  provider: "duckduckgo",
  maxResults: 5,
  hasApiKey: false,
  deepResearchEnabled: true,
};

describe("GET /api/me/web-search", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset().mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      email: "u@example.com",
      deptId: "d1",
    });
    getPublicWebSearchConfig.mockReset().mockResolvedValue(tenantConfig);
    isPlatformFeatureAllowedForUser.mockReset().mockResolvedValue(true);
  });

  it("hides web search when the user is not assigned the feature", async () => {
    isPlatformFeatureAllowedForUser.mockImplementation(async (feature: string) => feature !== "web_search");
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { enabled?: boolean; deepResearchEnabled?: boolean } };
    expect(json.data?.enabled).toBe(false);
    expect(json.data?.deepResearchEnabled).toBe(true);
  });

  it("hides deep research when the user is not assigned the feature", async () => {
    isPlatformFeatureAllowedForUser.mockImplementation(async (feature: string) => feature !== "deep_research");
    const { GET } = await import("../route");
    const res = await GET();
    const json = (await res.json()) as { data?: { enabled?: boolean; deepResearchEnabled?: boolean } };
    expect(json.data?.enabled).toBe(true);
    expect(json.data?.deepResearchEnabled).toBe(false);
  });

  it("keeps tenant switches on when assignment cannot be read", async () => {
    isPlatformFeatureAllowedForUser.mockRejectedValue(new Error("db down"));
    const { GET } = await import("../route");
    const res = await GET();
    const json = (await res.json()) as { data?: { enabled?: boolean; deepResearchEnabled?: boolean } };
    expect(json.data?.enabled).toBe(true);
    expect(json.data?.deepResearchEnabled).toBe(true);
  });
});

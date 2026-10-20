import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const getQuotaConfigMock = vi.fn();
const setQuotaConfigMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../lib/token-quota-store", () => ({
  getQuotaConfig: () => getQuotaConfigMock(),
  setQuotaConfig: (body: unknown) => setQuotaConfigMock(body),
  quotaFilePath: () => "/var/runtime/admin/quotas.json",
}));

import { GET, PUT } from "./route";

describe("metering quota route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    getQuotaConfigMock.mockReset();
    setQuotaConfigMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({ ok: true });
  });

  it("does not return a legacy quota file path", async () => {
    getQuotaConfigMock.mockResolvedValue({ tenant: { monthlyTokens: 10 } });
    const response = await GET();
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data.quota).toEqual({ tenant: { monthlyTokens: 10 } });
    expect(body.data).not.toHaveProperty("file");
    expect(JSON.stringify(body)).not.toContain("quotas.json");
  });

  it("does not return a legacy quota file path after save", async () => {
    setQuotaConfigMock.mockImplementation(async (body: unknown) => body);
    const response = await PUT(
      new Request("http://localhost/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant: { monthlyTokens: 3 } }),
      }),
    );
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty("file");
    expect(JSON.stringify(body)).not.toContain("quotas.json");
  });

  it("accepts a featureUsage ceiling and returns it with the saved quota", async () => {
    const featureUsage = {
      defaults: { role: { staff: { deepResearchRunsPerDay: 3 } } },
      departments: { "d-1": { searchCallsPerDay: 5 } },
      company: { searchCallsPerMonth: 100 },
    };
    setQuotaConfigMock.mockImplementation(async (body: unknown) => body);
    const response = await PUT(
      new Request("http://localhost/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ featureUsage }),
      }),
    );
    expect(response.status).toBe(200);
    expect(setQuotaConfigMock).toHaveBeenCalledWith({ featureUsage });
    const body = (await response.json()) as { data: { quota: { featureUsage: unknown } } };
    expect(body.data.quota.featureUsage).toEqual(featureUsage);
  });

  it.each([
    [{ featureUsage: { users: { u1: { deepResearchRunsPerDay: -1 } } } }, "non-negative integer"],
    [{ featureUsage: { company: { searchCallsPerDay: 1.5 } } }, "non-negative integer"],
    [{ featureUsage: { groups: { g1: { searchCallsPerWeek: "3" } } } }, "non-negative integer"],
    [{ featureUsage: { extra: {} } }, "not a feature usage field"],
  ])("rejects an invalid featureUsage document: %j", async (payload, fragment) => {
    const response = await PUT(
      new Request("http://localhost/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain(fragment);
    expect(setQuotaConfigMock).not.toHaveBeenCalled();
  });

  it("returns stored featureUsage unchanged", async () => {
    const featureUsage = { users: { u1: { deepResearchRunsPerDay: 2 } } };
    getQuotaConfigMock.mockResolvedValue({ defaults: { role: {} }, featureUsage });
    const response = await GET();
    const body = (await response.json()) as { data: { quota: { featureUsage: unknown } } };
    expect(body.data.quota.featureUsage).toEqual(featureUsage);
  });
});

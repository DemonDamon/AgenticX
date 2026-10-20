import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaConflictError } from "../../../../lib/quota-config-patch";

const requireAdminScopeMock = vi.fn();
const getQuotaConfigMock = vi.fn();
const setQuotaConfigMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../lib/token-quota-store", () => ({
  getQuotaConfig: () => getQuotaConfigMock(),
  setQuotaConfig: (body: unknown, options?: unknown) => (
    options === undefined ? setQuotaConfigMock(body) : setQuotaConfigMock(body, options)
  ),
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

  it("merges a featureUsage patch without clearing token quotas", async () => {
    const storedAt = "2026-10-20T00:00:00.000Z";
    getQuotaConfigMock.mockResolvedValue({
      defaults: { role: { staff: { monthlyTokens: 10, action: "warn" } } },
      users: { u1: { monthlyTokens: 5, action: "warn" } },
      departments: { sales: { monthlyTokens: 8, action: "block" } },
      featureUsage: { company: { searchCallsPerMonth: 9 } },
      updatedAt: storedAt,
    });
    setQuotaConfigMock.mockImplementation(async (body: unknown) => body);
    const featureUsage = {
      company: { searchCallsPerMonth: 9 },
      users: { u2: { searchCallsPerDay: 2 } },
    };
    const response = await PUT(
      new Request("http://localhost/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: storedAt, featureUsage }),
      }),
    );
    expect(response.status).toBe(200);
    expect(setQuotaConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        users: { u1: { monthlyTokens: 5, action: "warn" } },
        departments: { sales: { monthlyTokens: 8, action: "block" } },
        featureUsage,
      }),
      { expectedUpdatedAt: storedAt },
    );
  });

  it("returns 409 when the stored quota changed since it was loaded", async () => {
    getQuotaConfigMock.mockResolvedValue({ defaults: { role: {} }, users: {}, updatedAt: "2026-10-20T00:00:00.000Z" });
    setQuotaConfigMock.mockRejectedValue(new QuotaConflictError());
    const response = await PUT(
      new Request("http://localhost/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: "2026-10-19T00:00:00.000Z",
          featureUsage: { users: { u1: { searchCallsPerDay: 1 } } },
        }),
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string; message?: string };
    expect(body.code).toBe("40900");
    expect(body.message).toContain("请刷新后重试");
  });

  it("returns stored featureUsage unchanged", async () => {
    const featureUsage = { users: { u1: { deepResearchRunsPerDay: 2 } } };
    getQuotaConfigMock.mockResolvedValue({ defaults: { role: {} }, featureUsage });
    const response = await GET();
    const body = (await response.json()) as { data: { quota: { featureUsage: unknown } } };
    expect(body.data.quota.featureUsage).toEqual(featureUsage);
  });
});

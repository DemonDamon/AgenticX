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
});

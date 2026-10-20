import { describe, expect, it, vi } from "vitest";

const getIamDb = vi.hoisted(() => vi.fn(() => {
  throw new Error("quota store down");
}));

vi.mock("@agenticx/iam-core", () => ({
  resolveDatabaseConfig: () => ({ dialect: "postgresql" }),
  getIamDb,
  createMysqlDb: vi.fn(),
}));

import { loadFeatureUsageConfigOrThrow } from "../config-reader";

describe("loadFeatureUsageConfigOrThrow", () => {
  it("throws FeatureUsageUnavailableError when the quota row cannot be read", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadFeatureUsageConfigOrThrow("t-1", "search_provider_calls")).rejects.toMatchObject({
      name: "FeatureUsageUnavailableError",
      feature: "search_provider_calls",
      userMessage: "暂时无法确认搜索次数，请稍后再试",
    });
    expect(reported).toHaveBeenCalled();
    reported.mockRestore();
  });
});

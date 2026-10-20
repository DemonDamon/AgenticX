import { describe, expect, it, vi } from "vitest";
import type { FeatureUsagePolicies } from "@agenticx/config";

const execute = vi.hoisted(() => vi.fn());

vi.mock("@agenticx/iam-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenticx/iam-core")>();
  return {
    ...actual,
    resolveDatabaseConfig: () => ({ dialect: "postgresql" }),
    getIamDb: () => ({ execute }),
  };
});

import { featureUsageCountingRequired } from "../gate";

const NONE = { limits: { day: 0, week: 0, month: 0 }, source: "none" as const };

function policies(overrides: Partial<FeatureUsagePolicies> = {}): FeatureUsagePolicies {
  return { personal: NONE, department: NONE, company: NONE, ...overrides };
}

describe("featureUsageCountingRequired", () => {
  it("keeps counting whenever any layer has a ceiling, without probing the schema", async () => {
    execute.mockReset();
    const limited = policies({ department: { limits: { day: 3, week: 0, month: 0 }, source: "department" } });
    await expect(featureUsageCountingRequired(limited)).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("skips counting when nothing is limited and the counter table is not migrated yet", async () => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [{ present: false }] });
    await expect(featureUsageCountingRequired(policies())).resolves.toBe(false);
  });

  it("propagates a failed schema probe so callers fail closed", async () => {
    execute.mockReset();
    execute.mockRejectedValue(new Error("connection refused"));
    await expect(featureUsageCountingRequired(policies())).rejects.toThrow("connection refused");
  });

  it("counts once the table exists and remembers it", async () => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [{ present: true }] });
    await expect(featureUsageCountingRequired(policies())).resolves.toBe(true);
    execute.mockClear();
    await expect(featureUsageCountingRequired(policies())).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});

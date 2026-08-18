import { describe, expect, it } from "vitest";

import { mergeQuotaConfigPatch } from "../token-quota-config";

describe("mergeQuotaConfigPatch", () => {
  it("replaces submitted scope maps without clearing omitted quota fields", () => {
    const current: {
      defaults: { role: Record<string, unknown>; model: Record<string, unknown> };
      users: Record<string, { monthlyTokens: number }>;
      departments: Record<string, { monthlyTokens: number }>;
      groups: Record<string, { memberIds: string[] }>;
      updatedAt: string;
    } = {
      defaults: { role: {}, model: {} },
      users: { old: { monthlyTokens: 10 } },
      departments: { dept: { monthlyTokens: 20 } },
      groups: { group: { memberIds: ["old"] } },
      updatedAt: "2026-08-18T00:00:00.000Z",
    };

    const merged = mergeQuotaConfigPatch(current, {
      users: { next: { monthlyTokens: 30 } },
    });

    expect(merged.users).toEqual({ next: { monthlyTokens: 30 } });
    expect(merged.departments).toEqual(current.departments);
    expect(merged.groups).toEqual(current.groups);
  });
});

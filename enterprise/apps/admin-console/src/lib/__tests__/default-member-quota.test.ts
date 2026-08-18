import { describe, expect, it } from "vitest";
import {
  defaultMemberQuotaLimits,
  normalizeDefaultMemberTokenLimit,
  withDefaultMemberQuotaLimits,
  type DefaultMemberQuotaConfig,
} from "../default-member-quota";

const quota: DefaultMemberQuotaConfig = {
  defaults: {
    role: {
      admin: { monthlyTokens: 1_500_000, action: "block" },
      staff: {
        monthlyTokens: 600_000,
        dailyTokens: 30_000,
        weeklyTokens: 150_000,
        tpm: 2_000,
        rpm: 30,
        maxConcurrency: 4,
        requestsPerDay: 80,
        requestsPerWeek: 400,
        requestsPerMonth: 1_600,
        poolScope: "tenant",
        action: "fallback",
      },
      guest: { monthlyTokens: 300_000, action: "warn" },
    },
    model: {
      expensive: { monthlyTokens: 25_000, action: "block" },
    },
  },
  updatedAt: "2026-08-18T00:00:00.000Z",
};

describe("default member quota controls", () => {
  it("reads the staff day, week, and month limits", () => {
    expect(defaultMemberQuotaLimits(quota)).toEqual({
      dailyTokens: 30_000,
      weeklyTokens: 150_000,
      monthlyTokens: 600_000,
    });
  });

  it("builds only the version and complete defaults patch", () => {
    const update = withDefaultMemberQuotaLimits(quota, {
      dailyTokens: 50_000,
      weeklyTokens: 250_000,
      monthlyTokens: 1_000_000,
    });

    expect(Object.keys(update).sort()).toEqual(["defaults", "expectedUpdatedAt"]);
    expect(update.expectedUpdatedAt).toBe(quota.updatedAt);
    expect(update.defaults.role.admin).toEqual(quota.defaults.role.admin);
    expect(update.defaults.role.guest).toEqual(quota.defaults.role.guest);
    expect(update.defaults.model).toEqual(quota.defaults.model);
    expect(update.defaults.role.staff).toEqual({
      ...quota.defaults.role.staff,
      dailyTokens: 50_000,
      weeklyTokens: 250_000,
      monthlyTokens: 1_000_000,
    });
    expect(quota.defaults.role.staff?.dailyTokens).toBe(30_000);
  });

  it("keeps all non-window staff settings when a limit becomes unlimited", () => {
    const update = withDefaultMemberQuotaLimits(quota, {
      dailyTokens: 0,
      weeklyTokens: 0,
      monthlyTokens: 0,
    });

    expect(update.defaults.role.staff).toMatchObject({
      dailyTokens: 0,
      weeklyTokens: 0,
      monthlyTokens: 0,
      tpm: 2_000,
      rpm: 30,
      maxConcurrency: 4,
      poolScope: "tenant",
      action: "fallback",
    });
  });

  it("normalizes invalid and fractional input without creating negative limits", () => {
    expect(normalizeDefaultMemberTokenLimit("12500.9")).toBe(12_500);
    expect(normalizeDefaultMemberTokenLimit(-1)).toBe(0);
    expect(normalizeDefaultMemberTokenLimit("not-a-number")).toBe(0);
    expect(normalizeDefaultMemberTokenLimit(0)).toBe(0);
  });

  it("creates a blocking staff default when a legacy config has none", () => {
    const legacy: DefaultMemberQuotaConfig = {
      defaults: { role: {}, model: quota.defaults.model },
      updatedAt: quota.updatedAt,
    };

    const update = withDefaultMemberQuotaLimits(legacy, {
      dailyTokens: 10_000,
      weeklyTokens: 50_000,
      monthlyTokens: 200_000,
    });

    expect(update.defaults.role.staff).toEqual({
      monthlyTokens: 200_000,
      dailyTokens: 10_000,
      weeklyTokens: 50_000,
      action: "block",
    });
  });
});

export type DefaultMemberQuotaAction = "block" | "warn" | "fallback";

export type DefaultMemberQuotaRule = {
  monthlyTokens: number;
  dailyTokens?: number;
  weeklyTokens?: number;
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
  requestsPerDay?: number;
  requestsPerWeek?: number;
  requestsPerMonth?: number;
  poolScope?: "" | "dept" | "tenant";
  action: DefaultMemberQuotaAction;
};

export type DefaultMemberQuotaConfig = {
  defaults: {
    role: Record<string, DefaultMemberQuotaRule>;
    model: Record<string, DefaultMemberQuotaRule>;
  };
  updatedAt: string;
};

export type DefaultMemberQuotaLimits = {
  dailyTokens: number;
  weeklyTokens: number;
  monthlyTokens: number;
};

export type DefaultMemberQuotaUpdate = {
  expectedUpdatedAt: string;
  defaults: DefaultMemberQuotaConfig["defaults"];
};

export function normalizeDefaultMemberTokenLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function defaultMemberQuotaLimits(
  quota: DefaultMemberQuotaConfig,
): DefaultMemberQuotaLimits {
  const staff = quota.defaults.role.staff;
  return {
    dailyTokens: normalizeDefaultMemberTokenLimit(staff?.dailyTokens),
    weeklyTokens: normalizeDefaultMemberTokenLimit(staff?.weeklyTokens),
    monthlyTokens: normalizeDefaultMemberTokenLimit(staff?.monthlyTokens),
  };
}

/**
 * Build the narrow quota API patch used by the compact Admin control.
 * The API receives the complete defaults object so concurrent role/model
 * defaults are never erased while only the staff time-window limits change.
 */
export function withDefaultMemberQuotaLimits(
  quota: DefaultMemberQuotaConfig,
  limits: DefaultMemberQuotaLimits,
): DefaultMemberQuotaUpdate {
  const currentStaff = quota.defaults.role.staff ?? {
    monthlyTokens: 0,
    action: "block" as const,
  };

  return {
    expectedUpdatedAt: quota.updatedAt,
    defaults: {
      role: {
        ...quota.defaults.role,
        staff: {
          ...currentStaff,
          dailyTokens: normalizeDefaultMemberTokenLimit(limits.dailyTokens),
          weeklyTokens: normalizeDefaultMemberTokenLimit(limits.weeklyTokens),
          monthlyTokens: normalizeDefaultMemberTokenLimit(limits.monthlyTokens),
        },
      },
      model: { ...quota.defaults.model },
    },
  };
}

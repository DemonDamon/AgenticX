export type BudgetAction = "block" | "warn" | "fallback";

export type BudgetRule = {
  unit: "cost_usd" | "tokens";
  period: "day" | "week" | "month";
  limit: number;
  warnThresholdPct?: number;
  action: BudgetAction;
  fallbackModel?: string;
};

export type BudgetConfig = {
  updatedAt: string;
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

export function companyMonthlyTokenLimit(config: BudgetConfig | null | undefined): number {
  const rule = config?.defaults;
  if (rule?.unit !== "tokens" || rule.period !== "month" || rule.action !== "block") return 0;
  return Math.max(0, Math.floor(Number(rule.limit) || 0));
}

export function withCompanyMonthlyTokenLimit(config: BudgetConfig, limit: number): BudgetConfig {
  return {
    ...config,
    defaults: {
      ...config.defaults,
      unit: "tokens",
      period: "month",
      limit: Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0)),
      warnThresholdPct: config.defaults?.warnThresholdPct ?? 80,
      action: "block",
      fallbackModel: undefined,
    },
  };
}

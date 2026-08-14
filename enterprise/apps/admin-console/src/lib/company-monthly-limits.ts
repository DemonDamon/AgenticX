export type BudgetAction = "block" | "warn" | "fallback";

export type BudgetRule = {
  unit: "cost_usd" | "tokens";
  period: "day" | "week" | "month";
  limit: number;
  warnThresholdPct?: number;
  action: BudgetAction;
  fallbackModel?: string;
};

export type CompanyMonthlyLimits = {
  tokens: number;
  costUsd: number;
};

export type BudgetConfig = {
  updatedAt: string;
  companyLimits?: CompanyMonthlyLimits;
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function companyMonthlyLimits(config: BudgetConfig | null | undefined): CompanyMonthlyLimits {
  let tokens = positiveNumber(config?.companyLimits?.tokens);
  let costUsd = positiveNumber(config?.companyLimits?.costUsd);

  // 兼容旧版组织页把公司硬上限写入 defaults 的数据；首次保存后迁入独立双上限字段。
  const legacy = config?.defaults;
  if (legacy?.period === "month" && legacy.action === "block") {
    if (legacy.unit === "tokens" && tokens === 0) tokens = positiveNumber(legacy.limit);
    if (legacy.unit === "cost_usd" && costUsd === 0) costUsd = positiveNumber(legacy.limit);
  }
  return { tokens, costUsd };
}

export function withCompanyMonthlyLimits(
  config: BudgetConfig,
  limits: CompanyMonthlyLimits,
): BudgetConfig {
  const legacy = config.defaults;
  const migratedDefaults =
    legacy?.period === "month" && legacy.action === "block"
      ? { ...legacy, limit: 0 }
      : legacy;
  return {
    ...config,
    companyLimits: {
      tokens: Math.floor(positiveNumber(limits.tokens)),
      costUsd: positiveNumber(limits.costUsd),
    },
    defaults: migratedDefaults,
  };
}

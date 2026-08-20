import {
  normalizeSessionTokenLimits,
  type SessionTokenLimits,
} from "@agenticx/config";

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
  sessionTokenLimits?: SessionTokenLimits;
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * ``companyLimits`` 一旦作为独立字段存在，就说明这份配置已经迁过了，``defaults``
 * 从此是「默认成员预算」那条真规则，不再是旧版公司硬上限的载体。
 *
 * 不加这个判断的话，管理员配了「每人每月 $20 · block」之后，只要再去公司硬上限那张卡
 * 点一次保存，这条默认预算就会被当成旧数据把 limit 抹成 0 —— 静默的。
 */
function alreadyMigrated(config: BudgetConfig | null | undefined): boolean {
  return Boolean(config?.companyLimits);
}

export function companyMonthlyLimits(config: BudgetConfig | null | undefined): CompanyMonthlyLimits {
  let tokens = positiveNumber(config?.companyLimits?.tokens);
  let costUsd = positiveNumber(config?.companyLimits?.costUsd);

  // 兼容旧版组织页把公司硬上限写入 defaults 的数据；首次保存后迁入独立双上限字段。
  const legacy = config?.defaults;
  if (!alreadyMigrated(config) && legacy?.period === "month" && legacy.action === "block") {
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
    !alreadyMigrated(config) && legacy?.period === "month" && legacy.action === "block"
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

export function sessionTokenLimits(
  config: BudgetConfig | null | undefined,
): SessionTokenLimits {
  return normalizeSessionTokenLimits(config?.sessionTokenLimits);
}

export function withSessionTokenLimits(
  config: BudgetConfig,
  limits: SessionTokenLimits,
): BudgetConfig {
  return {
    ...config,
    sessionTokenLimits: normalizeSessionTokenLimits(limits),
  };
}

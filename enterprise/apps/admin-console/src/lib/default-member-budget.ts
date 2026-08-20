import type { BudgetAction, BudgetConfig, BudgetRule } from "./company-monthly-limits";

export type BudgetUnit = BudgetRule["unit"];
export type BudgetPeriod = BudgetRule["period"];

/**
 * 全租户的**默认成员预算**：没有单独配过的人都走这一条。
 *
 * 缺了它，一百来号人就得一个一个配 —— 部门和个人两级编辑器早就在了，唯独没有
 * 「所有人默认」这一档，而那恰恰是最常用的一档。
 *
 * 「Token 还是 USD」是这条规则自己的 unit 字段，天然二选一：网关侧
 * (internal/quota/budget.go) 两种单位都认，同一条规则只按其中一种结算。
 */
export type DefaultMemberBudget = {
  enabled: boolean;
  unit: BudgetUnit;
  period: BudgetPeriod;
  limit: number;
  warnThresholdPct: number;
  action: BudgetAction;
};

export const DEFAULT_MEMBER_BUDGET: DefaultMemberBudget = {
  enabled: false,
  unit: "cost_usd",
  period: "month",
  limit: 0,
  warnThresholdPct: 80,
  action: "warn",
};

function positive(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isUnit(value: unknown): value is BudgetUnit {
  return value === "cost_usd" || value === "tokens";
}

function isPeriod(value: unknown): value is BudgetPeriod {
  return value === "day" || value === "week" || value === "month";
}

function isAction(value: unknown): value is BudgetAction {
  return value === "warn" || value === "block" || value === "fallback";
}

export function defaultMemberBudget(
  config: BudgetConfig | null | undefined,
): DefaultMemberBudget {
  const rule = config?.defaults;
  if (!rule) return { ...DEFAULT_MEMBER_BUDGET };
  const limit = positive(rule.limit);
  return {
    // limit 为 0 = 没启用。留着一条 limit=0 的规则会让人以为「配过了」，
    // 而它实际什么都不限制。
    enabled: limit > 0,
    unit: isUnit(rule.unit) ? rule.unit : DEFAULT_MEMBER_BUDGET.unit,
    period: isPeriod(rule.period) ? rule.period : DEFAULT_MEMBER_BUDGET.period,
    limit,
    warnThresholdPct: positive(rule.warnThresholdPct, DEFAULT_MEMBER_BUDGET.warnThresholdPct),
    action: isAction(rule.action) ? rule.action : DEFAULT_MEMBER_BUDGET.action,
  };
}

/**
 * Token 单位下的上限必须是整数；USD 允许小数。
 */
export function normalizeBudgetLimit(unit: BudgetUnit, value: unknown): number {
  const parsed = positive(value);
  return unit === "tokens" ? Math.floor(parsed) : parsed;
}

/**
 * 只改 ``defaults`` 这一条，其余原样带回并附上版本号：这份配置是整份 PUT 的，
 * 服务端做乐观并发，不带回原值会把别人刚配的抹掉。
 */
export function withDefaultMemberBudget(
  config: BudgetConfig,
  next: DefaultMemberBudget,
): { expectedUpdatedAt: string; defaults: BudgetRule } {
  const limit = next.enabled ? normalizeBudgetLimit(next.unit, next.limit) : 0;
  return {
    expectedUpdatedAt: config.updatedAt,
    defaults: {
      unit: next.unit,
      period: next.period,
      limit,
      warnThresholdPct: Math.min(100, Math.max(0, Math.round(next.warnThresholdPct))),
      action: next.action,
    },
  };
}

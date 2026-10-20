/** 个人层生效规则。部门与公司是独立共享池，不在这里解析。 */

export type MemberSpendingRule = {
  unit: "tokens" | "cost_usd";
  period: "day" | "week" | "month";
  limit: number;
  action: "block" | "warn" | "fallback";
  warnThresholdPct?: number;
  fallbackModel?: string;
};

export type MemberSpendingConfig = {
  companyLimits?: { tokens: number; costUsd: number };
  defaults?: MemberSpendingRule;
  users?: Record<string, MemberSpendingRule>;
  groups?: Record<string, MemberSpendingRule>;
  /** 读取时填入的组成员关系，不写入预算 JSON。 */
  userGroups?: Record<string, string[]>;
  departments?: Record<string, MemberSpendingRule>;
  tenants?: Record<string, MemberSpendingRule>;
};

export type MemberSpendingSource = "user" | "group" | "default" | "none";

export type MemberSpendingSelection = {
  source: MemberSpendingSource;
  rules: MemberSpendingRule[];
};

/**
 * 个人层：个人特例 > 所在用户组里同单位同周期最严的一条 > 每人默认。
 * 用户组规则的动作固定为停止请求。
 */
export function memberSpendingRules(
  config: MemberSpendingConfig | undefined,
  context: { userId: string; groupIds?: readonly string[] },
): MemberSpendingSelection {
  const personal = config?.users?.[context.userId];
  if (personal && personal.limit > 0) return { source: "user", rules: [{ ...personal }] };

  const groupIds = context.groupIds ?? config?.userGroups?.[context.userId] ?? [];
  const strictest = new Map<string, MemberSpendingRule>();
  for (const groupId of new Set(groupIds)) {
    const rule = config?.groups?.[groupId];
    if (!rule || rule.limit <= 0) continue;
    const key = `${rule.unit}:${rule.period}`;
    const previous = strictest.get(key);
    if (!previous || rule.limit < previous.limit) strictest.set(key, { ...rule, action: "block" });
  }
  if (strictest.size > 0) {
    return {
      source: "group",
      rules: [...strictest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rule]) => rule),
    };
  }

  const defaults = config?.defaults;
  if (defaults && defaults.limit > 0) return { source: "default", rules: [{ ...defaults }] };
  return { source: "none", rules: [] };
}

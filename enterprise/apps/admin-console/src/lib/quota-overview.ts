/**
 * Member and group limit summaries for the organization page.
 * Spending comes from the layered budget. Search and research counts come
 * from the same daily counters the ceilings are enforced against.
 */

import {
  FEATURE_USAGE_FIELDS,
  FEATURE_USAGE_WINDOWS,
  featureUsageDayRange,
  featureUsageState,
  memberSpendingRules,
  normalizeFeatureUsageLimit,
  resolveFeatureUsageLimits,
  type FeatureUsageConfig,
  type FeatureUsageLimits,
  type FeatureUsageRule,
  type FeatureUsageSubject,
  type FeatureUsageWindow,
  type MemberSpendingConfig,
  type MemberSpendingRule,
  type MemberSpendingSource,
  type MeteredFeature,
} from "@agenticx/config";
import { enterpriseFeatureUsageDaily as pgFeatureUsage } from "@agenticx/db-schema";
import { enterpriseFeatureUsageDaily as mysqlFeatureUsage } from "@agenticx/db-schema/mysql";
import {
  getAdminUser,
  getIamDb,
  getQuotaWindowUsagesForUsers,
  resolveDatabaseConfig,
  type QuotaWindow,
  type QuotaWindowUsageTotals,
} from "@agenticx/iam-core";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { getBudgetConfig } from "./budget-store";
import { getAdminMysqlDb } from "./db-stores/mysql/database";
import { getQuotaConfig } from "./token-quota-store";
import { listUserGroups } from "./user-groups-store";

export type BudgetOverview = {
  rule: MemberSpendingRule | null;
  source: MemberSpendingSource;
  used: number;
  period: QuotaWindow;
  periodLabel: string;
};

export type FeatureCountOverview = {
  limit: number;
  used: number;
  remaining: number | null;
  source: "user" | "group" | "default" | "none";
  window: FeatureUsageWindow | null;
};

export type UserQuotaOverviewItem = {
  userId: string;
  budget: BudgetOverview;
  features: {
    search_provider_calls: FeatureCountOverview;
    deep_research_runs: FeatureCountOverview;
  };
};

export type GroupLimitOverview = {
  id: string;
  name: string;
  memberCount: number;
  spending: MemberSpendingRule | null;
  search: FeatureUsageLimits;
  research: FeatureUsageLimits;
};

export type FeatureDayRow = {
  userId: string;
  feature: string;
  day: string;
  used: number;
};

type MemberContext = {
  id: string;
  deptId: string | null;
  roleCodes: string[];
};

type GroupContext = {
  id: string;
  name: string;
  memberIds: string[];
};

type SpendBucket = { tokens: number; costUsd: number };

export type QuotaOverviewDeps = {
  getBudget: () => Promise<MemberSpendingConfig>;
  getFeatureUsage: () => Promise<FeatureUsageConfig | undefined>;
  listGroups: () => Promise<GroupContext[]>;
  listMembers: (userIds: readonly string[]) => Promise<MemberContext[]>;
  readSpend: (userIds: readonly string[]) => Promise<QuotaWindowUsageTotals[]>;
  readFeatureDays: (userIds: readonly string[], fromDay: string, toDay: string) => Promise<FeatureDayRow[]>;
};

const PERIOD_LABEL: Record<QuotaWindow, string> = {
  day: "今日",
  week: "本周",
  month: "本月",
};

const EMPTY_WINDOWS: Record<FeatureUsageWindow, number> = { day: 0, week: 0, month: 0 };

export function spendingSourceLabel(source: MemberSpendingSource): string {
  switch (source) {
    case "user":
      return "个人特例";
    case "group":
      return "用户组";
    case "default":
      return "每人默认";
    case "none":
      return "未设上限";
    default: {
      const exhausted: never = source;
      return exhausted;
    }
  }
}

function emptySpend(): Record<QuotaWindow, SpendBucket> {
  return {
    day: { tokens: 0, costUsd: 0 },
    week: { tokens: 0, costUsd: 0 },
    month: { tokens: 0, costUsd: 0 },
  };
}

export function budgetOverviewForMember(input: {
  budget: MemberSpendingConfig | undefined;
  userId: string;
  groupIds?: readonly string[];
  usage?: Partial<Record<QuotaWindow, SpendBucket>>;
}): BudgetOverview {
  const spending = memberSpendingRules(input.budget, {
    userId: input.userId,
    groupIds: input.groupIds,
  });
  const rule = spending.rules.find((item) => item.unit === "tokens") ?? spending.rules[0] ?? null;
  const period = rule?.period ?? "month";
  const bucket = input.usage?.[period] ?? { tokens: 0, costUsd: 0 };
  return {
    rule,
    source: spending.source,
    used: rule?.unit === "cost_usd" ? bucket.costUsd : bucket.tokens,
    period,
    periodLabel: PERIOD_LABEL[period],
  };
}

export function featureCountOverview(
  config: FeatureUsageConfig | undefined,
  feature: MeteredFeature,
  subject: FeatureUsageSubject,
  used: Record<FeatureUsageWindow, number>,
): FeatureCountOverview {
  const resolution = resolveFeatureUsageLimits(config, feature, subject);
  const state = featureUsageState(feature, resolution, used);
  if (!state.binding) {
    return {
      limit: 0,
      used: Math.max(0, Math.floor(used.month || 0)),
      remaining: null,
      source: resolution.source === "user" || resolution.source === "group" || resolution.source === "default"
        ? resolution.source
        : "none",
      window: null,
    };
  }
  const source = state.source === "user" || state.source === "group" || state.source === "default"
    ? state.source
    : "none";
  return {
    limit: state.binding.limit,
    used: state.binding.used,
    remaining: state.binding.remaining,
    source,
    window: state.binding.window,
  };
}

export function featureUsedByUser(
  rows: readonly FeatureDayRow[],
  now = new Date(),
): Map<string, Record<MeteredFeature, Record<FeatureUsageWindow, number>>> {
  const ranges = Object.fromEntries(
    FEATURE_USAGE_WINDOWS.map((window) => [window, featureUsageDayRange(window, now)]),
  ) as Record<FeatureUsageWindow, { fromDay: string; toDay: string }>;
  const byUser = new Map<string, Record<MeteredFeature, Record<FeatureUsageWindow, number>>>();
  const ensure = (userId: string) => {
    const current = byUser.get(userId);
    if (current) return current;
    const created: Record<MeteredFeature, Record<FeatureUsageWindow, number>> = {
      search_provider_calls: { ...EMPTY_WINDOWS },
      deep_research_runs: { ...EMPTY_WINDOWS },
    };
    byUser.set(userId, created);
    return created;
  };
  for (const row of rows) {
    if (row.feature !== "search_provider_calls" && row.feature !== "deep_research_runs") continue;
    const bucket = ensure(row.userId);
    for (const window of FEATURE_USAGE_WINDOWS) {
      const range = ranges[window];
      if (row.day >= range.fromDay && row.day <= range.toDay) {
        bucket[row.feature][window] += Math.max(0, Number(row.used) || 0);
      }
    }
  }
  return byUser;
}

function limitsOf(rule: FeatureUsageRule | undefined, feature: MeteredFeature): FeatureUsageLimits {
  const fields = FEATURE_USAGE_FIELDS[feature];
  return {
    day: normalizeFeatureUsageLimit(rule?.[fields.day]),
    week: normalizeFeatureUsageLimit(rule?.[fields.week]),
    month: normalizeFeatureUsageLimit(rule?.[fields.month]),
  };
}

function spendingRuleForGroup(budget: MemberSpendingConfig | undefined, groupId: string): MemberSpendingRule | null {
  const rule = budget?.groups?.[groupId];
  if (!rule || rule.limit <= 0) return null;
  return {
    unit: rule.unit,
    period: rule.period,
    limit: rule.limit,
    warnThresholdPct: rule.warnThresholdPct,
    action: "block",
  };
}

function indexSpend(rows: readonly QuotaWindowUsageTotals[]): Map<string, Record<QuotaWindow, SpendBucket>> {
  const byUser = new Map<string, Record<QuotaWindow, SpendBucket>>();
  for (const row of rows) {
    const current = byUser.get(row.userId) ?? emptySpend();
    current[row.window] = { tokens: row.tokens, costUsd: row.costUsd };
    byUser.set(row.userId, current);
  }
  return byUser;
}

function groupIdsFor(groups: readonly GroupContext[]): Map<string, string[]> {
  const byUser = new Map<string, string[]>();
  for (const group of groups) {
    for (const userId of group.memberIds) {
      const ids = byUser.get(userId) ?? [];
      ids.push(group.id);
      byUser.set(userId, ids);
    }
  }
  return byUser;
}

export async function loadUserQuotaOverview(
  tenantId: string,
  userIds: readonly string[],
  deps: QuotaOverviewDeps = defaultDeps(tenantId),
  now = new Date(),
): Promise<UserQuotaOverviewItem[]> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const month = featureUsageDayRange("month", now);
  const [budget, featureUsage, groups, members, spendRows, featureDays] = await Promise.all([
    deps.getBudget(),
    deps.getFeatureUsage(),
    deps.listGroups(),
    deps.listMembers(ids),
    deps.readSpend(ids),
    deps.readFeatureDays(ids, month.fromDay, month.toDay),
  ]);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const groupsByUser = groupIdsFor(groups);
  const spendByUser = indexSpend(spendRows);
  const featureByUser = featureUsedByUser(featureDays, now);
  return ids.map((userId) => {
    const member = memberById.get(userId);
    const subject: FeatureUsageSubject = {
      userId,
      deptId: member?.deptId,
      groupIds: groupsByUser.get(userId) ?? [],
      roles: member?.roleCodes ?? [],
    };
    const used = featureByUser.get(userId);
    return {
      userId,
      budget: budgetOverviewForMember({
        budget,
        userId,
        groupIds: subject.groupIds ?? [],
        usage: spendByUser.get(userId),
      }),
      features: {
        search_provider_calls: featureCountOverview(
          featureUsage,
          "search_provider_calls",
          subject,
          used?.search_provider_calls ?? { ...EMPTY_WINDOWS },
        ),
        deep_research_runs: featureCountOverview(
          featureUsage,
          "deep_research_runs",
          subject,
          used?.deep_research_runs ?? { ...EMPTY_WINDOWS },
        ),
      },
    };
  });
}

export async function loadGroupLimitOverview(
  tenantId: string,
  deps: Pick<QuotaOverviewDeps, "getBudget" | "getFeatureUsage" | "listGroups"> = defaultDeps(tenantId),
): Promise<GroupLimitOverview[]> {
  const [budget, featureUsage, groups] = await Promise.all([
    deps.getBudget(),
    deps.getFeatureUsage(),
    deps.listGroups(),
  ]);
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberIds.length,
    spending: spendingRuleForGroup(budget, group.id),
    search: limitsOf(featureUsage?.groups?.[group.id], "search_provider_calls"),
    research: limitsOf(featureUsage?.groups?.[group.id], "deep_research_runs"),
  }));
}

function defaultDeps(tenantId: string): QuotaOverviewDeps {
  return {
    getBudget: () => getBudgetConfig(tenantId),
    getFeatureUsage: async () => (await getQuotaConfig()).featureUsage,
    listGroups: async () => {
      const groups = await listUserGroups(tenantId);
      return groups.map((group) => ({ id: group.id, name: group.name, memberIds: group.memberIds }));
    },
    listMembers: async (userIds) => {
      const rows = await Promise.all(userIds.map((id) => getAdminUser(tenantId, id)));
      return rows.flatMap((user) => user ? [{ id: user.id, deptId: user.deptId, roleCodes: user.roleCodes }] : []);
    },
    readSpend: (userIds) => getQuotaWindowUsagesForUsers({
      tenantId,
      userIds,
      windows: ["day", "week", "month"],
    }),
    readFeatureDays: (userIds, fromDay, toDay) => readFeatureUsageDays(tenantId, userIds, fromDay, toDay),
  };
}

async function readFeatureUsageDays(
  tenantId: string,
  userIds: readonly string[],
  fromDay: string,
  toDay: string,
): Promise<FeatureDayRow[]> {
  if (!process.env.DATABASE_URL?.trim() || userIds.length === 0) return [];
  const mysql = resolveDatabaseConfig().dialect === "mysql";
  const rows: FeatureDayRow[] = [];
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const chunk = [...userIds.slice(offset, offset + 100)];
    if (mysql) {
      const table = mysqlFeatureUsage;
      const selected = await getAdminMysqlDb()
        .select({
          userId: table.userId,
          feature: table.feature,
          day: table.usageDay,
          used: sql<number>`coalesce(sum(${table.used}), 0)`,
        })
        .from(table)
        .where(and(
          eq(table.tenantId, tenantId),
          inArray(table.userId, chunk),
          gte(table.usageDay, fromDay),
          lte(table.usageDay, toDay),
        ))
        .groupBy(table.userId, table.feature, table.usageDay);
      rows.push(...selected.map((row) => ({
        userId: String(row.userId),
        feature: String(row.feature),
        day: String(row.day),
        used: Number(row.used ?? 0),
      })));
      continue;
    }
    const table = pgFeatureUsage;
    const selected = await getIamDb()
      .select({
        userId: table.userId,
        feature: table.feature,
        day: table.usageDay,
        used: sql<number>`coalesce(sum(${table.used}), 0)`,
      })
      .from(table)
      .where(and(
        eq(table.tenantId, tenantId),
        inArray(table.userId, chunk),
        gte(table.usageDay, fromDay),
        lte(table.usageDay, toDay),
      ))
      .groupBy(table.userId, table.feature, table.usageDay);
    rows.push(...selected.map((row) => ({
      userId: String(row.userId),
      feature: String(row.feature),
      day: String(row.day),
      used: Number(row.used ?? 0),
    })));
  }
  return rows;
}

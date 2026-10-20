import {
  FEATURE_USAGE_FALLBACK_ROLE,
  FEATURE_USAGE_FIELDS,
  FEATURE_USAGE_WINDOWS,
  type FeatureUsageConfig,
  type FeatureUsageRule,
  type FeatureUsageWindow,
  type MeteredFeature,
} from "@agenticx/config";

export type LimitScope = "defaults" | "groups" | "users" | "departments";
export type SpendingUnit = "tokens" | "cost_usd";
export type SpendingPeriod = "day" | "week" | "month";
export type SpendingAction = "warn" | "block" | "fallback";

export type SpendingDraft = {
  enabled: boolean;
  unit: SpendingUnit;
  period: SpendingPeriod;
  limit: number;
  warnThresholdPct: number;
  action: SpendingAction;
  fallbackModel?: string;
};

export type SpendingRule = {
  unit: SpendingUnit;
  period: SpendingPeriod;
  limit: number;
  warnThresholdPct?: number;
  action: SpendingAction;
  fallbackModel?: string;
};

export type BudgetDocument = {
  updatedAt: string;
  defaults?: SpendingRule;
  departments?: Record<string, SpendingRule>;
  groups?: Record<string, SpendingRule>;
  users?: Record<string, SpendingRule>;
};

const EMPTY_DRAFT: SpendingDraft = {
  enabled: false,
  unit: "tokens",
  period: "month",
  limit: 0,
  warnThresholdPct: 80,
  action: "warn",
};

export function fixedSpendingAction(scope: LimitScope): boolean {
  return scope === "departments" || scope === "groups";
}

/** Token and USD are one field. Choosing one replaces the other. */
export function selectSpendingUnit(draft: SpendingDraft, unit: SpendingUnit): SpendingDraft {
  if (draft.unit === unit) return draft;
  const limit = Number(draft.limit);
  const safe = Number.isFinite(limit) && limit > 0 ? limit : 0;
  return {
    ...draft,
    unit,
    limit: unit === "tokens" ? Math.floor(safe) : safe,
  };
}

export function actionForScope(scope: LimitScope, action: SpendingAction): SpendingAction {
  return fixedSpendingAction(scope) ? "block" : action;
}

export function spendingDraftFromRule(rule?: SpendingRule | null): SpendingDraft {
  if (!rule || !(rule.limit > 0)) return { ...EMPTY_DRAFT };
  const unit = rule.unit === "cost_usd" ? "cost_usd" : "tokens";
  return {
    enabled: true,
    unit,
    period: rule.period === "day" || rule.period === "week" ? rule.period : "month",
    limit: unit === "tokens" ? Math.floor(rule.limit) : rule.limit,
    warnThresholdPct: Math.min(100, Math.max(0, Number(rule.warnThresholdPct ?? 80))),
    action: rule.action === "block" || rule.action === "fallback" ? rule.action : "warn",
    ...(rule.fallbackModel ? { fallbackModel: rule.fallbackModel } : {}),
  };
}

function ruleFromDraft(scope: LimitScope, draft: SpendingDraft): SpendingRule {
  const limit = draft.enabled ? Math.max(0, Number(draft.limit) || 0) : 0;
  const action = actionForScope(scope, draft.action);
  return {
    unit: draft.unit,
    period: draft.period,
    limit: draft.unit === "tokens" ? Math.floor(limit) : limit,
    warnThresholdPct: Math.min(100, Math.max(0, Math.round(Number(draft.warnThresholdPct ?? 80)))),
    action,
    ...(action === "fallback" && draft.fallbackModel?.trim() ? { fallbackModel: draft.fallbackModel.trim() } : {}),
  };
}

function scopeMap(current: BudgetDocument, scope: Exclude<LimitScope, "defaults">): Record<string, SpendingRule> {
  return { ...(current[scope] ?? {}) };
}

/** Body for PUT /api/metering/budget: only the edited scope, plus the version. */
export function budgetSaveBody(input: {
  scope: LimitScope;
  id?: string;
  current: BudgetDocument;
  draft: SpendingDraft;
}): { expectedUpdatedAt: string } & Record<string, unknown> {
  const rule = ruleFromDraft(input.scope, input.draft);
  if (input.scope === "defaults") {
    return {
      expectedUpdatedAt: input.current.updatedAt,
      defaults: input.draft.enabled && rule.limit > 0 ? rule : { ...rule, limit: 0, action: rule.action },
    };
  }
  const map = scopeMap(input.current, input.scope);
  const id = input.id ?? "";
  if (input.draft.enabled && rule.limit > 0 && id) map[id] = rule;
  else delete map[id];
  return { expectedUpdatedAt: input.current.updatedAt, [input.scope]: map };
}

function ruleAt(config: FeatureUsageConfig | undefined, scope: LimitScope, id: string): FeatureUsageRule {
  if (scope === "defaults") return { ...(config?.defaults?.role?.[id] ?? {}) };
  return { ...(config?.[scope]?.[id] ?? {}) };
}

function withoutFeature(rule: FeatureUsageRule, feature: MeteredFeature): FeatureUsageRule {
  const next = { ...rule };
  for (const field of Object.values(FEATURE_USAGE_FIELDS[feature])) delete next[field];
  return next;
}

/** Body for PUT /api/metering/quota: only featureUsage, leaving token quotas untouched. */
export function featureSaveBody(input: {
  scope: LimitScope;
  id?: string;
  updatedAt: string;
  current: FeatureUsageConfig | undefined;
  feature: MeteredFeature;
  values: Partial<Record<FeatureUsageWindow, number>>;
}): { expectedUpdatedAt: string; featureUsage: FeatureUsageConfig } {
  const target = input.scope === "defaults" ? FEATURE_USAGE_FALLBACK_ROLE : (input.id ?? "");
  const fields = FEATURE_USAGE_FIELDS[input.feature];
  const nextRule = withoutFeature(ruleAt(input.current, input.scope, target), input.feature);
  for (const window of FEATURE_USAGE_WINDOWS) {
    const value = Number(input.values[window] ?? 0);
    if (Number.isInteger(value) && value > 0) nextRule[fields[window]] = value;
  }
  const featureUsage: FeatureUsageConfig = {
    ...input.current,
    defaults: { role: { ...(input.current?.defaults?.role ?? {}) } },
    departments: { ...(input.current?.departments ?? {}) },
    groups: { ...(input.current?.groups ?? {}) },
    users: { ...(input.current?.users ?? {}) },
  };
  const empty = Object.keys(nextRule).length === 0;
  if (input.scope === "defaults") {
    const role = featureUsage.defaults?.role ?? {};
    if (empty) delete role[target];
    else role[target] = nextRule;
    featureUsage.defaults = { role };
  } else if (target) {
    const map = featureUsage[input.scope] ?? {};
    if (empty) delete map[target];
    else map[target] = nextRule;
    featureUsage[input.scope] = map;
  }
  return { expectedUpdatedAt: input.updatedAt, featureUsage };
}

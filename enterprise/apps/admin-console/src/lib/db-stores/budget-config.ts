import {
  DEFAULT_SESSION_TOKEN_LIMITS,
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

export type BudgetConfig = {
  updatedAt: string;
  companyLimits?: {
    tokens: number;
    costUsd: number;
  };
  sessionTokenLimits: SessionTokenLimits;
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

export type BudgetConfigPatch = Partial<BudgetConfig>;

const DEFAULT_RULE: BudgetRule = {
  unit: "cost_usd",
  period: "month",
  limit: 0,
  warnThresholdPct: 80,
  action: "warn",
};

const PATCHABLE_KEYS = [
  "companyLimits",
  "sessionTokenLimits",
  "defaults",
  "tenants",
  "departments",
  "users",
] as const satisfies readonly (keyof BudgetConfig)[];

export class BudgetConfigConflictError extends Error {
  constructor() {
    super("budget config was updated by another request");
    this.name = "BudgetConfigConflictError";
  }
}

function normalizeRule(input: Partial<BudgetRule> | undefined): BudgetRule {
  const unit = input?.unit === "tokens" ? "tokens" : "cost_usd";
  const period = input?.period === "day" || input?.period === "week" ? input.period : "month";
  const limit = Number(input?.limit ?? 0);
  const warnThresholdPct = Number(input?.warnThresholdPct ?? 80);
  const action = input?.action === "block" || input?.action === "fallback" ? input.action : "warn";
  return {
    unit,
    period,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    warnThresholdPct: Number.isFinite(warnThresholdPct)
      ? Math.min(100, Math.max(0, warnThresholdPct))
      : 80,
    action,
    fallbackModel: input?.fallbackModel?.trim() || undefined,
  };
}

export function normalizeBudgetConfig(
  input: Partial<BudgetConfig> | undefined,
  updatedAt: Date = new Date(),
): BudgetConfig {
  const tokenLimit = Number(input?.companyLimits?.tokens ?? 0);
  const costLimit = Number(input?.companyLimits?.costUsd ?? 0);
  const next: BudgetConfig = {
    updatedAt: updatedAt.toISOString(),
    companyLimits: {
      tokens: Number.isFinite(tokenLimit) && tokenLimit > 0 ? Math.floor(tokenLimit) : 0,
      costUsd: Number.isFinite(costLimit) && costLimit > 0 ? costLimit : 0,
    },
    sessionTokenLimits: normalizeSessionTokenLimits(input?.sessionTokenLimits),
    defaults: normalizeRule(input?.defaults ?? DEFAULT_RULE),
    tenants: {},
    departments: {},
    users: {},
  };
  for (const [key, value] of Object.entries(input?.tenants ?? {})) {
    next.tenants![key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.departments ?? {})) {
    next.departments![key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.users ?? {})) {
    next.users![key] = normalizeRule(value);
  }
  return next;
}

export function defaultBudgetConfig(updatedAt: Date = new Date()): BudgetConfig {
  return normalizeBudgetConfig(
    {
      companyLimits: { tokens: 0, costUsd: 0 },
      sessionTokenLimits: DEFAULT_SESSION_TOKEN_LIMITS,
      defaults: DEFAULT_RULE,
      tenants: {},
      departments: {},
      users: {},
    },
    updatedAt,
  );
}

/**
 * Applies only top-level fields that the caller actually submitted. Scope maps
 * keep their existing replace-on-submit semantics so the quota editor can still
 * remove an entry; omitted maps remain byte-for-byte represented by the latest
 * database snapshot rather than being reset to an empty object.
 */
export function mergeBudgetConfigPatch(
  current: BudgetConfig,
  patch: BudgetConfigPatch,
  updatedAt: Date,
): BudgetConfig {
  const merged: Partial<BudgetConfig> = { ...current };
  for (const key of PATCHABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      Object.assign(merged, { [key]: patch[key] });
    }
  }
  return normalizeBudgetConfig(merged, updatedAt);
}

export function nextBudgetUpdatedAt(current: Date | undefined, now = new Date()): Date {
  if (!current || now.getTime() > current.getTime()) return now;
  return new Date(current.getTime() + 1);
}

export function requestedBudgetVersion(
  input: BudgetConfigPatch,
  expectedUpdatedAt?: string,
): Date | undefined {
  const version = expectedUpdatedAt ?? input.updatedAt;
  if (typeof version !== "string" || !version.trim()) return undefined;
  const parsed = new Date(version);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function sameBudgetVersion(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

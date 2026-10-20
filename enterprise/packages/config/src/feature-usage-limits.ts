/**
 * Independent shared and personal ceilings on web search and deep research.
 *
 * Company and department rules are shared pools. Personal exceptions, group
 * rules, and role defaults are per-member limits. These three pools must each
 * admit a request; a generous personal exception never bypasses a shared cap.
 *
 * The two features are counted in different units on purpose. Search counts
 * outbound provider calls. Deep research counts runs, because a single run
 * spends tens of provider calls and a per-run number is the only one an
 * administrator can reason about. Neither number is derivable from the other,
 * so they are configured and enforced independently.
 */

export type FeatureUsageWindow = "day" | "week" | "month";

export type MeteredFeature = "search_provider_calls" | "deep_research_runs";

export const METERED_FEATURES: readonly MeteredFeature[] = [
  "search_provider_calls",
  "deep_research_runs",
];

/** A limit of 0 means "not set at this layer", which reads as unlimited. */
export type FeatureUsageLimits = {
  day: number;
  week: number;
  month: number;
};

export const NO_FEATURE_USAGE_LIMITS: FeatureUsageLimits = { day: 0, week: 0, month: 0 };

/**
 * One layer's rule. Every field is optional so an existing quota document
 * without these keys resolves to "no ceiling" rather than to zero.
 */
export type FeatureUsageRule = {
  searchCallsPerDay?: number;
  searchCallsPerWeek?: number;
  searchCallsPerMonth?: number;
  deepResearchRunsPerDay?: number;
  deepResearchRunsPerWeek?: number;
  deepResearchRunsPerMonth?: number;
};

export type FeatureUsageConfig = {
  defaults?: { role?: Record<string, FeatureUsageRule | undefined> };
  company?: FeatureUsageRule;
  departments?: Record<string, FeatureUsageRule | undefined>;
  groups?: Record<string, FeatureUsageRule | undefined>;
  users?: Record<string, FeatureUsageRule | undefined>;
};

export type FeatureUsageSubject = {
  userId: string;
  deptId?: string | null;
  /** Current membership, looked up from the group relation rather than a saved snapshot. */
  groupIds?: readonly string[] | null;
  /** Every role the member actually holds, in any order. */
  roles?: readonly string[] | null;
};

/**
 * The key a rule for "everyone" is stored under.
 *
 * Not a role code — no member has it. It is the fallback the tenant default
 * card writes, and it stays the answer for anyone whose own roles carry no
 * rule of their own.
 */
export const FEATURE_USAGE_FALLBACK_ROLE = "staff";

/**
 * Role precedence, most privileged first.
 *
 * A member can hold several roles, and their ceilings have to resolve to one
 * answer. Taking the highest-privileged role that has a rule is deterministic
 * and explains itself in a sentence; picking "the most generous" would mean
 * comparing triples of day/week/month ceilings against each other, which has
 * no obvious answer when one role is generous daily and another monthly.
 */
export const FEATURE_USAGE_ROLE_PRECEDENCE: readonly string[] = [
  "super_admin",
  "owner",
  "admin",
  "dept_admin",
  "auditor",
  "sso_admin",
  "policy_admin",
  "policy_publisher",
  "policy_auditor",
  "member",
];

/** The roles an administrator can set a ceiling for, plus the catch-all. */
export const FEATURE_USAGE_CONFIGURABLE_ROLES: readonly string[] = [
  FEATURE_USAGE_FALLBACK_ROLE,
  ...FEATURE_USAGE_ROLE_PRECEDENCE,
];

export type FeatureUsageResolution = {
  limits: FeatureUsageLimits;
  /** Which layer produced the ceiling, for the admin and member explanations. */
  source: "user" | "group" | "default" | "department" | "company" | "none";
};

export type FeatureUsagePolicies = {
  personal: FeatureUsageResolution;
  department: FeatureUsageResolution;
  company: FeatureUsageResolution;
};

export const FEATURE_USAGE_FIELDS: Record<MeteredFeature, Record<FeatureUsageWindow, keyof FeatureUsageRule>> = {
  search_provider_calls: {
    day: "searchCallsPerDay",
    week: "searchCallsPerWeek",
    month: "searchCallsPerMonth",
  },
  deep_research_runs: {
    day: "deepResearchRunsPerDay",
    week: "deepResearchRunsPerWeek",
    month: "deepResearchRunsPerMonth",
  },
};

export const FEATURE_USAGE_RULE_FIELDS: (keyof FeatureUsageRule)[] = Object.values(FEATURE_USAGE_FIELDS).flatMap(
  (fields) => Object.values(fields),
);

export const FEATURE_USAGE_WINDOWS: readonly FeatureUsageWindow[] = ["day", "week", "month"];

/** Anything not a positive whole number is "no ceiling", never a silent zero. */
export function normalizeFeatureUsageLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function normalizeFeatureUsageRule(raw: unknown): FeatureUsageRule {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rule: FeatureUsageRule = {};
  for (const field of FEATURE_USAGE_RULE_FIELDS) {
    const value = normalizeFeatureUsageLimit(source[field]);
    if (value > 0) rule[field] = value;
  }
  return rule;
}

function normalizeRuleMap(raw: unknown): Record<string, FeatureUsageRule> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .map(([key, value]) => [key, normalizeFeatureUsageRule(value)] as const)
    .filter(([, rule]) => Object.keys(rule).length > 0));
}

/** Stored under quota.featureUsage so feature-only rules cannot override token rules. */
export function normalizeFeatureUsageConfig(raw: unknown): FeatureUsageConfig {
  const source = raw && typeof raw === "object" ? raw as FeatureUsageConfig : {};
  return {
    defaults: { role: normalizeRuleMap(source.defaults?.role) },
    company: normalizeFeatureUsageRule(source.company),
    departments: normalizeRuleMap(source.departments),
    groups: normalizeRuleMap(source.groups),
    users: normalizeRuleMap(source.users),
  };
}

function layerLimits(
  rule: FeatureUsageRule | undefined,
  feature: MeteredFeature,
): FeatureUsageLimits {
  const fields = FEATURE_USAGE_FIELDS[feature];
  return {
    day: normalizeFeatureUsageLimit(rule?.[fields.day]),
    week: normalizeFeatureUsageLimit(rule?.[fields.week]),
    month: normalizeFeatureUsageLimit(rule?.[fields.month]),
  };
}

function hasAnyLimit(limits: FeatureUsageLimits): boolean {
  return limits.day > 0 || limits.week > 0 || limits.month > 0;
}

/**
 * Resolve the personal ceiling that applies to one member.
 *
 * The first layer that names any window for this feature answers all three.
 * Personal rules replace group/default rules for the feature as a whole. Group
 * rules combine by taking the lowest configured cap in each window. A zero is
 * "unset", so another group's configured limit still applies.
 *
 * Inside the role layer the same rule applies across the roles a member holds:
 * the highest-privileged role with a rule answers, and the catch-all answers
 * for anyone whose roles carry none.
 */
export function resolveFeatureUsageLimits(
  config: FeatureUsageConfig | undefined,
  feature: MeteredFeature,
  subject: FeatureUsageSubject,
): FeatureUsageResolution {
  const personal = layerLimits(config?.users?.[subject.userId], feature);
  if (hasAnyLimit(personal)) return { limits: personal, source: "user" };

  const groups = { ...NO_FEATURE_USAGE_LIMITS };
  for (const id of new Set((subject.groupIds ?? []).map((raw) => String(raw ?? "").trim()).filter(Boolean))) {
    const limits = layerLimits(config?.groups?.[id], feature);
    for (const window of FEATURE_USAGE_WINDOWS) {
      const limit = limits[window];
      if (limit > 0 && (groups[window] === 0 || limit < groups[window])) groups[window] = limit;
    }
  }
  if (hasAnyLimit(groups)) return { limits: groups, source: "group" };

  const held = new Set(
    (subject.roles ?? []).map((role) => String(role ?? "").trim().toLowerCase()).filter(Boolean),
  );
  for (const role of FEATURE_USAGE_ROLE_PRECEDENCE) {
    if (!held.has(role)) continue;
    const byRole = layerLimits(config?.defaults?.role?.[role], feature);
    if (hasAnyLimit(byRole)) return { limits: byRole, source: "default" };
  }

  const fallback = layerLimits(
    config?.defaults?.role?.[FEATURE_USAGE_FALLBACK_ROLE],
    feature,
  );
  if (hasAnyLimit(fallback)) return { limits: fallback, source: "default" };

  return { limits: NO_FEATURE_USAGE_LIMITS, source: "none" };
}

/** Shared ceilings remain independent of the member's personal selection. */
export function resolveFeatureUsagePolicies(
  config: FeatureUsageConfig | undefined,
  feature: MeteredFeature,
  subject: FeatureUsageSubject,
): FeatureUsagePolicies {
  const deptId = subject.deptId?.trim();
  const department = deptId ? layerLimits(config?.departments?.[deptId], feature) : NO_FEATURE_USAGE_LIMITS;
  const company = layerLimits(config?.company, feature);
  return {
    personal: resolveFeatureUsageLimits(config, feature, subject),
    department: { limits: department, source: hasAnyLimit(department) ? "department" : "none" },
    company: { limits: company, source: hasAnyLimit(company) ? "company" : "none" },
  };
}

/** UTC calendar day, the key the usage counters are stored under. */
export function utcUsageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function startOfUtcIsoWeek(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // getUTCDay is 0 on Sunday; ISO weeks start on Monday.
  const weekday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - weekday);
  return start;
}

/**
 * The inclusive day range a window covers.
 *
 * Personal and shared counters each store one row per scope per day, so a week
 * or month ceiling sums daily rows rather than maintaining a second tally.
 */
export function featureUsageDayRange(
  window: FeatureUsageWindow,
  now: Date = new Date(),
): { fromDay: string; toDay: string } {
  const toDay = utcUsageDay(now);
  if (window === "day") return { fromDay: toDay, toDay };
  if (window === "week") return { fromDay: utcUsageDay(startOfUtcIsoWeek(now)), toDay };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { fromDay: utcUsageDay(monthStart), toDay };
}

export type FeatureUsageWindowState = {
  window: FeatureUsageWindow;
  limit: number;
  used: number;
  remaining: number;
  /** Present when several independent pools are combined for display. */
  source?: FeatureUsageResolution["source"];
};

export type FeatureUsageState = {
  feature: MeteredFeature;
  source: FeatureUsageResolution["source"];
  unlimited: boolean;
  /** Configuration or counters could not be verified; admission must fail closed. */
  unavailable?: boolean;
  /** Only the windows this member actually has a ceiling in. */
  windows: FeatureUsageWindowState[];
  /** The window with the least headroom, which is the one to show and enforce. */
  binding: FeatureUsageWindowState | null;
};

/**
 * Combine resolved ceilings with counted usage into what both the gate and the
 * member-facing indicator need.
 */
export function featureUsageState(
  feature: MeteredFeature,
  resolution: FeatureUsageResolution,
  used: Record<FeatureUsageWindow, number>,
): FeatureUsageState {
  const windows: FeatureUsageWindowState[] = [];
  for (const window of FEATURE_USAGE_WINDOWS) {
    const limit = resolution.limits[window];
    if (limit <= 0) continue;
    const spent = Math.max(0, Math.floor(used[window] ?? 0));
    windows.push({ window, limit, used: spent, remaining: Math.max(0, limit - spent) });
  }
  let binding: FeatureUsageWindowState | null = null;
  for (const state of windows) {
    if (!binding || state.remaining < binding.remaining) binding = state;
  }
  return {
    feature,
    source: resolution.source,
    unlimited: windows.length === 0,
    windows,
    binding,
  };
}

/** The member sees whichever independent pool has the least headroom. */
export function combineFeatureUsageStates(
  feature: MeteredFeature,
  states: readonly FeatureUsageState[],
): FeatureUsageState {
  const windows = states.flatMap((state) => state.windows.map((window) => ({ ...window, source: state.source })));
  let binding: FeatureUsageWindowState | null = null;
  for (const window of windows) {
    if (!binding || window.remaining < binding.remaining) binding = window;
  }
  return {
    feature,
    source: binding?.source ?? "none",
    unlimited: windows.length === 0,
    windows,
    binding,
  };
}

/**
 * Personal, department and company gates for search and deep research.
 *
 * Every configured pool fails closed when configuration or counters cannot be
 * read. An outage must not let one member spend an unbounded shared pool.
 */

import {
  resolveFeatureUsagePolicies,
  type FeatureUsagePolicies,
  type FeatureUsageState,
  type MeteredFeature,
} from "@agenticx/config";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { sql } from "drizzle-orm";

import { loadFeatureUsageConfigOrNone, loadFeatureUsageConfigOrThrow } from "./config-reader";
import {
  readFeatureUsagePolicyState,
  recordFeatureUsage,
  reserveFeatureUsage,
  type ResearchUsagePolicy,
} from "./counters";
import {
  FeatureUsageLimitError,
  FeatureUsageUnavailableError,
  reportFeatureUsageFailure,
} from "./errors";

export type FeatureUsageSubjectContext = {
  tenantId: string;
  userId: string;
  deptId?: string | null;
  groupIds?: readonly string[] | null;
  roles?: readonly string[] | null;
};

export {
  FeatureUsageLimitError,
  FeatureUsageUnavailableError,
  featureUsageExhaustedMessage,
  isFeatureUsageLimitError,
  isFeatureUsageUnavailableError,
} from "./errors";

const UNAVAILABLE = (feature: MeteredFeature): FeatureUsageState => ({
  feature,
  source: "none",
  unlimited: false,
  unavailable: true,
  windows: [],
  binding: null,
});

/**
 * What this member may still spend. Safe for display: it never throws, and
 * answers "unavailable" when the ceilings or the counters cannot be read.
 */
export async function readFeatureUsageState(
  feature: MeteredFeature,
  subject: FeatureUsageSubjectContext,
  now: Date = new Date(),
): Promise<FeatureUsageState> {
  const { config, readable } = await loadFeatureUsageConfigOrNone(subject.tenantId);
  if (!readable) return UNAVAILABLE(feature);

  const policies = resolveFeatureUsagePolicies(config, feature, {
    userId: subject.userId,
    deptId: subject.deptId,
    groupIds: subject.groupIds,
    roles: subject.roles,
  });
  try {
    return await readFeatureUsagePolicyState({
      tenantId: subject.tenantId,
      feature,
      userId: subject.userId,
      deptId: subject.deptId,
      policies,
      now,
    });
  } catch (error) {
    reportFeatureUsageFailure(`feature-usage:${feature}`, error);
    return UNAVAILABLE(feature);
  }
}

/** Throw when the member has nothing left in the tightest configured window. */
export async function admitFeatureUsage(
  feature: MeteredFeature,
  subject: FeatureUsageSubjectContext,
  now: Date = new Date(),
): Promise<FeatureUsageState> {
  const state = await readFeatureUsageState(feature, subject, now);
  if (state.unavailable) throw new FeatureUsageUnavailableError(feature);
  if (state.binding && state.binding.remaining <= 0) {
    throw new FeatureUsageLimitError(feature, state.binding);
  }
  return state;
}

/** A failed direct write is unavailable, not a silent success. */
export async function countFeatureUsage(
  feature: MeteredFeature,
  subject: FeatureUsageSubjectContext,
  delta = 1,
  now: Date = new Date(),
): Promise<void> {
  try {
    await recordFeatureUsage({
      tenantId: subject.tenantId,
      feature,
      userId: subject.userId,
      deptId: subject.deptId,
      delta,
      now,
    });
  } catch (error) {
    reportFeatureUsageFailure(`feature-usage:${feature}`, error);
    throw new FeatureUsageUnavailableError(feature, error);
  }
}

/** Admit and count one outbound search provider call for this member. */
let countersReady = false;
let missingCountersWarned = false;

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return (Array.isArray(result[0]) ? result[0] : result) as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? []);
}

async function featureUsageCountersReady(): Promise<boolean> {
  if (countersReady) return true;
  const config = resolveDatabaseConfig();
  const result =
    config.dialect === "mysql"
      ? await (await createMysqlDb(config)).raw.execute(
          sql`select count(*) as present from information_schema.tables
              where table_schema = database() and table_name = 'enterprise_feature_usage_daily'`,
        )
      : await getIamDb().execute(sql`select to_regclass('enterprise_feature_usage_daily') is not null as present`);
  const present = rowsOf(result)[0]?.present;
  countersReady = present === true || present === "t" || Number(present) > 0;
  return countersReady;
}

function policiesUnlimited(policies: FeatureUsagePolicies): boolean {
  return [policies.personal, policies.department, policies.company].every(
    ({ limits }) => limits.day <= 0 && limits.week <= 0 && limits.month <= 0,
  );
}

/**
 * Searches and research keep working during an upgrade that has not migrated the
 * counter tables yet, as long as nobody has configured a ceiling. Any configured
 * ceiling still fails closed.
 */
export async function featureUsageCountingRequired(policies: FeatureUsagePolicies): Promise<boolean> {
  if (!policiesUnlimited(policies)) return true;
  if (await featureUsageCountersReady()) return true;
  if (!missingCountersWarned) {
    missingCountersWarned = true;
    console.warn("[feature-usage] counter tables are missing; skipping usage counting until the migration runs");
  }
  return false;
}

export async function reserveMemberSearchProviderCall(
  subject: FeatureUsageSubjectContext,
  now: Date = new Date(),
): Promise<void> {
  const config = await loadFeatureUsageConfigOrThrow(subject.tenantId, "search_provider_calls");
  const policies = resolveFeatureUsagePolicies(config, "search_provider_calls", subject);
  try {
    if (!(await featureUsageCountingRequired(policies))) return;
  } catch (error) {
    reportFeatureUsageFailure("feature-usage:search_provider_calls", error);
    throw new FeatureUsageUnavailableError("search_provider_calls", error);
  }
  try {
    await reserveFeatureUsage({
      tenantId: subject.tenantId,
      feature: "search_provider_calls",
      userId: subject.userId,
      deptId: subject.deptId,
      policies,
      now,
    });
  } catch (error) {
    if (error instanceof FeatureUsageLimitError) throw error;
    reportFeatureUsageFailure("feature-usage:search_provider_calls", error);
    throw new FeatureUsageUnavailableError("search_provider_calls", error);
  }
}

/** Resolve policy before the run store opens its admission transaction. */
export async function researchUsagePolicy(
  subject: FeatureUsageSubjectContext,
): Promise<ResearchUsagePolicy> {
  const config = await loadFeatureUsageConfigOrThrow(subject.tenantId, "deep_research_runs");
  return {
    deptId: subject.deptId,
    policies: resolveFeatureUsagePolicies(config, "deep_research_runs", subject),
  };
}

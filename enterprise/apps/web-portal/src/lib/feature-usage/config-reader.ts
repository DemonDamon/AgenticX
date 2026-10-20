/**
 * Read search / deep-research ceilings from the tenant quota document.
 *
 * Only the `featureUsage` namespace is interpreted. Token quota fields that
 * share the same document are ignored.
 */

import {
  normalizeFeatureUsageConfig,
  type FeatureUsageConfig,
  type MeteredFeature,
} from "@agenticx/config";
import { enterpriseRuntimeTokenQuotas as pgTable } from "@agenticx/db-schema";
import { enterpriseRuntimeTokenQuotas as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

import { FeatureUsageUnavailableError, reportFeatureUsageFailure } from "./errors";

export const EMPTY_FEATURE_USAGE_CONFIG: FeatureUsageConfig = {
  defaults: { role: {} },
  company: {},
  departments: {},
  groups: {},
  users: {},
};

function asQuotaDocument(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Lift only the feature namespace out of a stored quota document. */
export function featureUsageConfigFromQuotaDocument(document: unknown): FeatureUsageConfig {
  const parsed = asQuotaDocument(document);
  const source = parsed && typeof parsed === "object"
    ? parsed as { featureUsage?: unknown }
    : {};
  return normalizeFeatureUsageConfig(source.featureUsage);
}

async function readQuotaDocument(tenantId: string): Promise<unknown> {
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const db = (await createMysqlDb(config)).raw;
    const rows = await db
      .select({ config: mysqlTable.config })
      .from(mysqlTable)
      .where(eq(mysqlTable.tenantId, tenantId))
      .limit(1);
    return rows[0]?.config;
  }
  const rows = await getIamDb()
    .select({ config: pgTable.config })
    .from(pgTable)
    .where(eq(pgTable.tenantId, tenantId))
    .limit(1);
  return rows[0]?.config;
}

/**
 * A tenant that has never saved a ceiling has no row. That is "no limit", not
 * a failure. A database that cannot answer throws, and admission must refuse.
 */
export async function loadFeatureUsageConfig(tenantId: string): Promise<FeatureUsageConfig> {
  const document = await readQuotaDocument(tenantId);
  return featureUsageConfigFromQuotaDocument(document);
}

/** Read the ceilings, or throw when the quota document cannot be read. */
export async function loadFeatureUsageConfigOrThrow(
  tenantId: string,
  feature: MeteredFeature,
): Promise<FeatureUsageConfig> {
  try {
    return await loadFeatureUsageConfig(tenantId);
  } catch (error) {
    if (error instanceof FeatureUsageUnavailableError) throw error;
    reportFeatureUsageFailure("feature-usage-config", error);
    throw new FeatureUsageUnavailableError(feature, error);
  }
}

/**
 * Display path. A failed read is `readable: false` so the badge can say the
 * count is unavailable without throwing during render.
 */
export async function loadFeatureUsageConfigOrNone(
  tenantId: string,
): Promise<{ config: FeatureUsageConfig; readable: boolean }> {
  try {
    return { config: await loadFeatureUsageConfig(tenantId), readable: true };
  } catch (error) {
    reportFeatureUsageFailure("feature-usage-config", error);
    return { config: EMPTY_FEATURE_USAGE_CONFIG, readable: false };
  }
}

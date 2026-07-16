import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/token-quota-store";
import * as postgresql from "./db-stores/postgresql/token-quota-store";

export type * from "./db-stores/postgresql/token-quota-store";
export { quotaFilePath, getPlanSources, applyPlanRuleToScope, removePlanRuleFromScope } from "./db-stores/postgresql/token-quota-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const getQuotaConfig: typeof postgresql.getQuotaConfig = (...args: Parameters<typeof postgresql.getQuotaConfig>) =>
  implementation().getQuotaConfig(...args);

export const setQuotaConfig: typeof postgresql.setQuotaConfig = (...args: Parameters<typeof postgresql.setQuotaConfig>) =>
  implementation().setQuotaConfig(...args);

export const persistQuotaConfig: typeof postgresql.persistQuotaConfig = (...args: Parameters<typeof postgresql.persistQuotaConfig>) =>
  implementation().persistQuotaConfig(...args);

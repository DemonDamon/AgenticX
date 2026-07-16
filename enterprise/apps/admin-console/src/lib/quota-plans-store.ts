import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/quota-plans-store";
import * as postgresql from "./db-stores/postgresql/quota-plans-store";

export type * from "./db-stores/postgresql/quota-plans-store";
export { computePeriodBounds, computeNextPeriodBounds, poolPeriodKey, planToQuotaRule } from "./db-stores/postgresql/quota-plans-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listQuotaPlans: typeof postgresql.listQuotaPlans = (...args: Parameters<typeof postgresql.listQuotaPlans>) =>
  implementation().listQuotaPlans(...args);

export const getQuotaPlan: typeof postgresql.getQuotaPlan = (...args: Parameters<typeof postgresql.getQuotaPlan>) =>
  implementation().getQuotaPlan(...args);

export const createQuotaPlan: typeof postgresql.createQuotaPlan = (...args: Parameters<typeof postgresql.createQuotaPlan>) =>
  implementation().createQuotaPlan(...args);

export const updateQuotaPlan: typeof postgresql.updateQuotaPlan = (...args: Parameters<typeof postgresql.updateQuotaPlan>) =>
  implementation().updateQuotaPlan(...args);

export const deleteQuotaPlan: typeof postgresql.deleteQuotaPlan = (...args: Parameters<typeof postgresql.deleteQuotaPlan>) =>
  implementation().deleteQuotaPlan(...args);

export const listPlanAssignments: typeof postgresql.listPlanAssignments = (...args: Parameters<typeof postgresql.listPlanAssignments>) =>
  implementation().listPlanAssignments(...args);

export const assignPlanToScope: typeof postgresql.assignPlanToScope = (...args: Parameters<typeof postgresql.assignPlanToScope>) =>
  implementation().assignPlanToScope(...args);

export const cancelPlanAssignment: typeof postgresql.cancelPlanAssignment = (...args: Parameters<typeof postgresql.cancelPlanAssignment>) =>
  implementation().cancelPlanAssignment(...args);

export const rebuildQuotaMappingFromPlans: typeof postgresql.rebuildQuotaMappingFromPlans = (...args: Parameters<typeof postgresql.rebuildQuotaMappingFromPlans>) =>
  implementation().rebuildQuotaMappingFromPlans(...args);

export const publishQuotaPlan: typeof postgresql.publishQuotaPlan = (...args: Parameters<typeof postgresql.publishQuotaPlan>) =>
  implementation().publishQuotaPlan(...args);

export const archiveQuotaPlan: typeof postgresql.archiveQuotaPlan = (...args: Parameters<typeof postgresql.archiveQuotaPlan>) =>
  implementation().archiveQuotaPlan(...args);

export const rolloverDueAssignments: typeof postgresql.rolloverDueAssignments = (...args: Parameters<typeof postgresql.rolloverDueAssignments>) =>
  implementation().rolloverDueAssignments(...args);

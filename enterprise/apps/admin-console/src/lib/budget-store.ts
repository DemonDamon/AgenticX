import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/budget-store";
import * as postgresql from "./db-stores/postgresql/budget-store";

export type * from "./db-stores/postgresql/budget-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const getBudgetConfig: typeof postgresql.getBudgetConfig = (...args: Parameters<typeof postgresql.getBudgetConfig>) =>
  implementation().getBudgetConfig(...args);

export const setBudgetConfig: typeof postgresql.setBudgetConfig = (...args: Parameters<typeof postgresql.setBudgetConfig>) =>
  implementation().setBudgetConfig(...args);

export const buildBudgetSnapshotForGateway: typeof postgresql.buildBudgetSnapshotForGateway = (...args: Parameters<typeof postgresql.buildBudgetSnapshotForGateway>) =>
  implementation().buildBudgetSnapshotForGateway(...args);

export const listBudgetAlerts: typeof postgresql.listBudgetAlerts = (...args: Parameters<typeof postgresql.listBudgetAlerts>) =>
  implementation().listBudgetAlerts(...args);

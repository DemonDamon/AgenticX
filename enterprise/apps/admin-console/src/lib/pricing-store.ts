import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/pricing-store";
import * as postgresql from "./db-stores/postgresql/pricing-store";

export type * from "./db-stores/postgresql/pricing-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const getPricingConfig: typeof postgresql.getPricingConfig = (...args: Parameters<typeof postgresql.getPricingConfig>) =>
  implementation().getPricingConfig(...args);

export const setPricingConfig: typeof postgresql.setPricingConfig = (...args: Parameters<typeof postgresql.setPricingConfig>) =>
  implementation().setPricingConfig(...args);

export const buildPricingSnapshotForGateway: typeof postgresql.buildPricingSnapshotForGateway = (...args: Parameters<typeof postgresql.buildPricingSnapshotForGateway>) =>
  implementation().buildPricingSnapshotForGateway(...args);

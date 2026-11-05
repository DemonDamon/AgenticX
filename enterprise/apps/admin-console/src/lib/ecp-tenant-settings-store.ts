/**
 * admin-console · ECP E4 租户分发策略（PG/MySQL 共用接口）
 */
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/ecp-tenant-settings-store";
import * as postgresql from "./db-stores/postgresql/ecp-tenant-settings-store";

export type * from "./db-stores/postgresql/ecp-tenant-settings-store";

function implementation() {
  return resolveDatabaseConfig().dialect === "mysql" ? mysql : postgresql;
}

export const getEcpTenantDistributionPolicy: typeof postgresql.getEcpTenantDistributionPolicy = (
  ...args
) => implementation().getEcpTenantDistributionPolicy(...args);

export const updateEcpTenantDistributionPolicy: typeof postgresql.updateEcpTenantDistributionPolicy =
  (...args) => implementation().updateEcpTenantDistributionPolicy(...args);

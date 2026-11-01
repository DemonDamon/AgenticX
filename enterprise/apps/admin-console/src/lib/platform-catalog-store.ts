import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/platform-catalog-store";
import * as postgresql from "./db-stores/postgresql/platform-catalog-store";

export type * from "./db-stores/postgresql/platform-catalog-store";
export {
  isPlatformOriginSkill,
  PlatformSkillMetadataReadonlyError,
} from "./db-stores/postgresql/platform-catalog-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listCatalogItems: typeof postgresql.listCatalogItems = (...args) =>
  implementation().listCatalogItems(...args);
export const getCatalogItem: typeof postgresql.getCatalogItem = (...args) =>
  implementation().getCatalogItem(...args);
export const createCatalogItem: typeof postgresql.createCatalogItem = (...args) =>
  implementation().createCatalogItem(...args);
export const updateCatalogItem: typeof postgresql.updateCatalogItem = (...args) =>
  implementation().updateCatalogItem(...args);
export const listGrantsForCatalogItem: typeof postgresql.listGrantsForCatalogItem = (...args) =>
  implementation().listGrantsForCatalogItem(...args);
export const grantCatalogToTenant: typeof postgresql.grantCatalogToTenant = (...args) =>
  implementation().grantCatalogToTenant(...args);
export const revokeCatalogFromTenant: typeof postgresql.revokeCatalogFromTenant = (...args) =>
  implementation().revokeCatalogFromTenant(...args);
export const listTenantSkillsForTest: typeof postgresql.listTenantSkillsForTest = (...args) =>
  implementation().listTenantSkillsForTest(...args);
export const tenantHasGrantedCatalogSkill: typeof postgresql.tenantHasGrantedCatalogSkill = (...args) =>
  implementation().tenantHasGrantedCatalogSkill(...args);
export const isCatalogUpdateVisibleToTenant: typeof postgresql.isCatalogUpdateVisibleToTenant = (...args) =>
  implementation().isCatalogUpdateVisibleToTenant(...args);

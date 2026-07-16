import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/model-providers-store";
import * as postgresql from "./db-stores/postgresql/model-providers-store";

export type * from "./db-stores/postgresql/model-providers-store";
export { __resetProvidersCache, providersFilePath, PROVIDER_TEMPLATES } from "./db-stores/postgresql/model-providers-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listProviders: typeof postgresql.listProviders = (...args: Parameters<typeof postgresql.listProviders>) =>
  implementation().listProviders(...args);

export const listAllEnabledModelIds: typeof postgresql.listAllEnabledModelIds = (...args: Parameters<typeof postgresql.listAllEnabledModelIds>) =>
  implementation().listAllEnabledModelIds(...args);

export const getProvider: typeof postgresql.getProvider = (...args: Parameters<typeof postgresql.getProvider>) =>
  implementation().getProvider(...args);

export const getProviderInternal: typeof postgresql.getProviderInternal = (...args: Parameters<typeof postgresql.getProviderInternal>) =>
  implementation().getProviderInternal(...args);

export const listProvidersInternal: typeof postgresql.listProvidersInternal = (...args: Parameters<typeof postgresql.listProvidersInternal>) =>
  implementation().listProvidersInternal(...args);

export const createProvider: typeof postgresql.createProvider = (...args: Parameters<typeof postgresql.createProvider>) =>
  implementation().createProvider(...args);

export const updateProvider: typeof postgresql.updateProvider = (...args: Parameters<typeof postgresql.updateProvider>) =>
  implementation().updateProvider(...args);

export const deleteProvider: typeof postgresql.deleteProvider = (...args: Parameters<typeof postgresql.deleteProvider>) =>
  implementation().deleteProvider(...args);

export const addProviderModel: typeof postgresql.addProviderModel = (...args: Parameters<typeof postgresql.addProviderModel>) =>
  implementation().addProviderModel(...args);

export const updateProviderModel: typeof postgresql.updateProviderModel = (...args: Parameters<typeof postgresql.updateProviderModel>) =>
  implementation().updateProviderModel(...args);

export const deleteProviderModel: typeof postgresql.deleteProviderModel = (...args: Parameters<typeof postgresql.deleteProviderModel>) =>
  implementation().deleteProviderModel(...args);

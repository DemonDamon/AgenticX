import { resolveDatabaseConfig } from "@agenticx/iam-core";

import * as mysql from "./db-stores/mysql/virtual-models-store";
import * as postgresql from "./db-stores/postgresql/virtual-models-store";

export type { VirtualModelInput, VirtualModelRecord, VirtualModelTarget } from "./virtual-models-shared";
export { validateVirtualModelInput } from "./virtual-models-shared";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listVirtualModels: typeof postgresql.listVirtualModels = (...args) =>
  implementation().listVirtualModels(...args);

export const listVirtualModelsInternal: typeof postgresql.listVirtualModelsInternal = (...args) =>
  implementation().listVirtualModelsInternal(...args);

export const createVirtualModel: typeof postgresql.createVirtualModel = (...args) =>
  implementation().createVirtualModel(...args);

export const updateVirtualModel: typeof postgresql.updateVirtualModel = (...args) =>
  implementation().updateVirtualModel(...args);

export const deleteVirtualModel: typeof postgresql.deleteVirtualModel = (...args) =>
  implementation().deleteVirtualModel(...args);

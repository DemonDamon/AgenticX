import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/user-models-store";
import * as postgresql from "./db-stores/postgresql/user-models-store";

export type * from "./db-stores/postgresql/user-models-store";
export {
  collectUserAssignmentKeys,
  mergeUserStoredSet,
} from "./db-stores/postgresql/user-models-store";
export { userModelsFilePath, __resetUserModelsCache } from "./db-stores/postgresql/user-models-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const readUserEditPayload: typeof postgresql.readUserEditPayload = (...args: Parameters<typeof postgresql.readUserEditPayload>) =>
  implementation().readUserEditPayload(...args);

export const getUserModels: typeof postgresql.getUserModels = (...args: Parameters<typeof postgresql.getUserModels>) =>
  implementation().getUserModels(...args);

export const setUserModels: typeof postgresql.setUserModels = (...args: Parameters<typeof postgresql.setUserModels>) =>
  implementation().setUserModels(...args);

export const listAllAssignments: typeof postgresql.listAllAssignments = (...args: Parameters<typeof postgresql.listAllAssignments>) =>
  implementation().listAllAssignments(...args);

export const deleteUserAssignment: typeof postgresql.deleteUserAssignment = (...args: Parameters<typeof postgresql.deleteUserAssignment>) =>
  implementation().deleteUserAssignment(...args);

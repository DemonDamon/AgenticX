import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/dept-models-store";
import * as postgresql from "./db-stores/postgresql/dept-models-store";

export type * from "./db-stores/postgresql/dept-models-store";
export { DEPT_PREFIX, deptKey } from "./db-stores/postgresql/dept-models-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const readDeptEditPayload: typeof postgresql.readDeptEditPayload = (...args: Parameters<typeof postgresql.readDeptEditPayload>) =>
  implementation().readDeptEditPayload(...args);

export const getDeptModels: typeof postgresql.getDeptModels = (...args: Parameters<typeof postgresql.getDeptModels>) =>
  implementation().getDeptModels(...args);

export const setDeptModels: typeof postgresql.setDeptModels = (...args: Parameters<typeof postgresql.setDeptModels>) =>
  implementation().setDeptModels(...args);

export const deleteDeptAssignment: typeof postgresql.deleteDeptAssignment = (...args: Parameters<typeof postgresql.deleteDeptAssignment>) =>
  implementation().deleteDeptAssignment(...args);

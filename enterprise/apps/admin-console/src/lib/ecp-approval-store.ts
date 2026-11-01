import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/ecp-approval-store";
import * as postgresql from "./db-stores/postgresql/ecp-approval-store";

export type * from "./db-stores/postgresql/ecp-approval-store";
export {
  ApprovalRequiredError,
  ApprovalWorkflowError,
} from "./db-stores/postgresql/ecp-approval-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listBuiltinPresets: typeof postgresql.listBuiltinPresets = (...args) =>
  implementation().listBuiltinPresets(...args);
export const getTenantApprovalSettings: typeof postgresql.getTenantApprovalSettings = (...args) =>
  implementation().getTenantApprovalSettings(...args);
export const upsertTenantApprovalSettings: typeof postgresql.upsertTenantApprovalSettings = (...args) =>
  implementation().upsertTenantApprovalSettings(...args);
export const getPlatformApprovalSettings: typeof postgresql.getPlatformApprovalSettings = (...args) =>
  implementation().getPlatformApprovalSettings(...args);
export const upsertPlatformApprovalSettings: typeof postgresql.upsertPlatformApprovalSettings = (...args) =>
  implementation().upsertPlatformApprovalSettings(...args);
export const createApprovalRequest: typeof postgresql.createApprovalRequest = (...args) =>
  implementation().createApprovalRequest(...args);
export const listApprovalRequests: typeof postgresql.listApprovalRequests = (...args) =>
  implementation().listApprovalRequests(...args);
export const getApprovalRequest: typeof postgresql.getApprovalRequest = (...args) =>
  implementation().getApprovalRequest(...args);
export const approveApprovalRequest: typeof postgresql.approveApprovalRequest = (...args) =>
  implementation().approveApprovalRequest(...args);
export const rejectApprovalRequest: typeof postgresql.rejectApprovalRequest = (...args) =>
  implementation().rejectApprovalRequest(...args);
export const consumeApprovalRequest: typeof postgresql.consumeApprovalRequest = (...args) =>
  implementation().consumeApprovalRequest(...args);
export const assertShelfPublishApproval: typeof postgresql.assertShelfPublishApproval = (...args) =>
  implementation().assertShelfPublishApproval(...args);
export const submitShelfPublishApprovalRequest: typeof postgresql.submitShelfPublishApprovalRequest =
  (...args) => implementation().submitShelfPublishApprovalRequest(...args);
export const submitPlatformIntroduceRequest: typeof postgresql.submitPlatformIntroduceRequest = (...args) =>
  implementation().submitPlatformIntroduceRequest(...args);

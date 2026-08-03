import {
  AuditApi,
  type AuditActor,
  type AuditQueryInput,
  createAuditStore,
  insertGatewayAuditExportEvent,
  verifyGatewayAuditChain,
} from "@agenticx/feature-audit";
import { getUsersRepository } from "@agenticx/iam-core";
import type { AdminSession } from "./admin-auth";

const store = createAuditStore();
const api = new AuditApi(store);

export async function buildAuditActor(session: AdminSession, scopes: string[]): Promise<AuditActor> {
  const user = await getUsersRepository().getAdminUser(session.tenantId, session.userId);
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    deptId: user?.deptId ?? null,
    scopes,
  };
}

export async function queryAudit(actor: AuditActor, input: AuditQueryInput) {
  return api.query(actor, input);
}

export async function exportAuditCsv(actor: AuditActor, input: AuditQueryInput) {
  return api.exportCsv(actor, input);
}

export { insertGatewayAuditExportEvent, verifyGatewayAuditChain };
export type { AuditActor };

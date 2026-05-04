import {
  AuditApi,
  type AuditActor,
  type AuditQueryInput,
  insertGatewayAuditExportEvent,
  PgAuditStore,
  verifyGatewayAuditChain,
} from "@agenticx/feature-audit";
import { getIamDb } from "@agenticx/iam-core";
import { users } from "@agenticx/db-schema";
import { and, eq } from "drizzle-orm";
import type { AdminSession } from "./admin-auth";

const store = new PgAuditStore();
const api = new AuditApi(store);

export async function buildAuditActor(session: AdminSession, scopes: string[]): Promise<AuditActor> {
  const db = getIamDb();
  const [row] = await db
    .select({ deptId: users.deptId })
    .from(users)
    .where(and(eq(users.tenantId, session.tenantId), eq(users.id, session.userId)))
    .limit(1);
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    deptId: row?.deptId ?? null,
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

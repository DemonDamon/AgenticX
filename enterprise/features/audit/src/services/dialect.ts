import { resolveDatabaseConfig } from "@agenticx/iam-core";
import type { AuditActor } from "../types";
import {
  insertMysqlGatewayAuditExportEvent,
  verifyMysqlGatewayAuditChain,
} from "./mysql-store";
import {
  insertPgGatewayAuditExportEvent,
  verifyPgGatewayAuditChain,
} from "./pg-store";

export async function verifyGatewayAuditChain(actor: AuditActor, tenantId: string) {
  if (resolveDatabaseConfig().dialect === "mysql") {
    return verifyMysqlGatewayAuditChain(actor, tenantId);
  }
  return verifyPgGatewayAuditChain(actor, tenantId);
}

export async function insertGatewayAuditExportEvent(
  actor: AuditActor,
  detail: Record<string, unknown>,
): Promise<void> {
  if (resolveDatabaseConfig().dialect === "mysql") {
    await insertMysqlGatewayAuditExportEvent(actor, detail);
    return;
  }
  await insertPgGatewayAuditExportEvent(actor, detail);
}

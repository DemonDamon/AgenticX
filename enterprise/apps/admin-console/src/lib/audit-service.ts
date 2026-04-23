import path from "node:path";
import { AuditApi, LocalAuditStore, type AuditActor, type AuditQueryInput } from "@agenticx/feature-audit";

const auditLogDir = path.resolve(process.cwd(), "../gateway/.runtime/audit");

const store = new LocalAuditStore(auditLogDir);
const api = new AuditApi(store);

const auditorActor: AuditActor = {
  tenantId: "tenant_default",
  userId: "user_auditor",
  deptId: null,
  scopes: ["audit:read:all"],
};

export async function queryAudit(input: AuditQueryInput) {
  return api.query(auditorActor, input);
}

export async function exportAuditCsv(input: AuditQueryInput) {
  return api.exportCsv(auditorActor, input);
}


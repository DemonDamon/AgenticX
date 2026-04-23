import type { AuditEvent, AuditQueryInput, AuditQueryResult } from "@agenticx/core-api";

export type AuditActor = {
  tenantId: string;
  userId: string;
  deptId?: string | null;
  scopes: string[];
};

export type AuditStore = {
  query(actor: AuditActor, input: AuditQueryInput): Promise<AuditQueryResult>;
  exportCsv(actor: AuditActor, input: AuditQueryInput): Promise<string>;
};

export type { AuditEvent, AuditQueryInput, AuditQueryResult };


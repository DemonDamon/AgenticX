// Console-side admin audit helper (SP2). Thin wrapper over the IAM
// audit_events store so admin API routes follow the audit-before-action
// discipline with a single call site.

import { insertAuditEvent } from "@agenticx/iam-core";

import type { AdminSession } from "./admin-auth";

export async function auditConsoleEvent(
  session: AdminSession,
  eventType: string,
  targetKind: string,
  detail: Record<string, unknown>,
  targetId?: string,
): Promise<void> {
  await insertAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.userId ?? null,
    eventType,
    targetKind,
    targetId: targetId ?? (typeof detail.model === "string" ? detail.model : null),
    detail,
  });
}

import { auditEvents } from "@agenticx/db-schema";
import { ulid } from "ulid";
import type { IamDb } from "../db";
import { getIamDb } from "../db";

export type AuditInsert = {
  tenantId: string;
  actorUserId: string | null;
  eventType: string;
  targetKind: string;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
};

const SENSITIVE_AUDIT_KEY = /^(access_?token|refresh_?token|id_?token|client_?secret|authorization|password|secret)$/i;

/**
 * Strip sensitive OIDC/token fields before writing audit detail (FR-B1.3).
 */
export function sanitizeSsoAuditDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SENSITIVE_AUDIT_KEY.test(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeSsoAuditDetail(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function insertAuditEvent(input: AuditInsert, dbOrTx?: IamDb): Promise<void> {
  const db = dbOrTx ?? getIamDb();
  const now = new Date();
  await db.insert(auditEvents).values({
    id: ulid(),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    detail: input.detail ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

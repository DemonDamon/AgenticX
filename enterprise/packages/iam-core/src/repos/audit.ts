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

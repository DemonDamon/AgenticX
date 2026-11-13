import { securityIncidentActions, securityIncidents } from "@agenticx/db-schema";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import type { IamDb } from "../../db";
import { getIamDb } from "../../db";
import type { SecurityIncidentRepository } from "../contracts";
import {
  canTransitionIncidentStatus,
  mapIncidentActionRow,
  mapIncidentRow,
  type SecurityIncidentActionInsert,
  type SecurityIncidentActionRecord,
  type SecurityIncidentInsert,
  type SecurityIncidentListOptions,
  type SecurityIncidentRecord,
  type SecurityIncidentStatusUpdate,
} from "../incidents";

export async function createPostgresqlIncident(
  input: SecurityIncidentInsert,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord> {
  const db = dbOrTx ?? getIamDb();
  const now = new Date();
  const [row] = await db
    .insert(securityIncidents)
    .values({
      id: ulid(),
      tenantId: input.tenantId,
      title: input.title,
      source: input.source ?? "manual",
      severity: input.severity ?? "high",
      status: "open",
      traceId: input.traceId ?? null,
      sessionId: input.sessionId ?? null,
      userId: input.userId ?? null,
      model: input.model ?? null,
      summary: input.summary ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("create incident failed");
  return mapIncidentRow(row);
}

export async function getPostgresqlIncident(
  tenantId: string,
  incidentId: string,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord | null> {
  const db = dbOrTx ?? getIamDb();
  const [row] = await db
    .select()
    .from(securityIncidents)
    .where(and(eq(securityIncidents.tenantId, tenantId), eq(securityIncidents.id, incidentId)))
    .limit(1);
  return row ? mapIncidentRow(row) : null;
}

export async function listPostgresqlIncidents(
  tenantId: string,
  opts?: SecurityIncidentListOptions,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord[]> {
  const db = dbOrTx ?? getIamDb();
  const conditions = [eq(securityIncidents.tenantId, tenantId)];
  if (opts?.status) {
    conditions.push(eq(securityIncidents.status, opts.status));
  }
  const rows = await db
    .select()
    .from(securityIncidents)
    .where(and(...conditions))
    .orderBy(desc(securityIncidents.createdAt))
    .limit(Math.min(Math.max(opts?.limit ?? 100, 1), 500));
  return rows.map(mapIncidentRow);
}

export async function updatePostgresqlIncidentStatus(
  input: SecurityIncidentStatusUpdate,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord | null> {
  const db = dbOrTx ?? getIamDb();
  const current = await getPostgresqlIncident(input.tenantId, input.incidentId, db);
  if (!current) return null;
  if (!canTransitionIncidentStatus(current.status, input.status)) {
    throw new Error(`illegal incident status transition: ${current.status} -> ${input.status}`);
  }
  if (input.status === "resolved" && !input.resolutionNote?.trim()) {
    throw new Error("resolution note required when resolving an incident");
  }
  const now = new Date();
  const patch: Partial<typeof securityIncidents.$inferInsert> = {
    status: input.status,
    updatedAt: now,
  };
  if (input.status === "handling") {
    patch.handledAt = now;
    patch.resolvedAt = null;
    patch.resolutionNote = null;
  }
  if (input.status === "resolved") {
    patch.resolvedAt = now;
    patch.resolutionNote = input.resolutionNote ?? null;
  }
  const [row] = await db
    .update(securityIncidents)
    .set(patch)
    .where(and(eq(securityIncidents.tenantId, input.tenantId), eq(securityIncidents.id, input.incidentId)))
    .returning();
  if (!row) throw new Error("update incident status failed");
  return mapIncidentRow(row);
}

export async function insertPostgresqlIncidentAction(
  input: SecurityIncidentActionInsert,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentActionRecord> {
  const db = dbOrTx ?? getIamDb();
  const [row] = await db
    .insert(securityIncidentActions)
    .values({
      id: ulid(),
      incidentId: input.incidentId,
      tenantId: input.tenantId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      actorUserId: input.actorUserId ?? null,
      detail: input.detail ? JSON.stringify(input.detail) : null,
      outcome: input.outcome,
      createdAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("insert incident action failed");
  return mapIncidentActionRow(row);
}

export async function listPostgresqlIncidentActions(
  tenantId: string,
  incidentId: string,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentActionRecord[]> {
  const db = dbOrTx ?? getIamDb();
  const rows = await db
    .select()
    .from(securityIncidentActions)
    .where(
      and(
        eq(securityIncidentActions.tenantId, tenantId),
        eq(securityIncidentActions.incidentId, incidentId),
      ),
    )
    .orderBy(securityIncidentActions.createdAt);
  return rows.map(mapIncidentActionRow);
}

export const postgresqlSecurityIncidentRepository: SecurityIncidentRepository = {
  dialect: "postgresql",
  createIncident: createPostgresqlIncident,
  getIncident: getPostgresqlIncident,
  listIncidents: listPostgresqlIncidents,
  updateIncidentStatus: updatePostgresqlIncidentStatus,
  insertIncidentAction: insertPostgresqlIncidentAction,
  listIncidentActions: listPostgresqlIncidentActions,
};

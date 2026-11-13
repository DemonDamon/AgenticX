import { securityIncidentActions, securityIncidents } from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import type { SecurityIncidentRepository } from "../contracts";
import {
  canTransitionIncidentStatus,
  type SecurityIncidentActionInsert,
  type SecurityIncidentActionRecord,
  type SecurityIncidentInsert,
  type SecurityIncidentListOptions,
  type SecurityIncidentRecord,
  type SecurityIncidentStatusUpdate,
} from "../incidents";
import type { IamDb } from "../../db";
import { getMysqlRepositoryDb } from "./db";

function mapIncidentRow(row: typeof securityIncidents.$inferSelect): SecurityIncidentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    source: (row.source as SecurityIncidentRecord["source"]) ?? "manual",
    severity: (row.severity as SecurityIncidentRecord["severity"]) ?? "high",
    status: (row.status as SecurityIncidentRecord["status"]) ?? "open",
    traceId: row.traceId ?? null,
    sessionId: row.sessionId ?? null,
    userId: row.userId ?? null,
    model: row.model ?? null,
    summary: row.summary ?? null,
    createdBy: row.createdBy ?? null,
    handledAt: row.handledAt ? new Date(row.handledAt).toISOString() : null,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
    resolutionNote: row.resolutionNote ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function mapIncidentActionRow(
  row: typeof securityIncidentActions.$inferSelect,
): SecurityIncidentActionRecord {
  return {
    id: row.id,
    incidentId: row.incidentId,
    tenantId: row.tenantId,
    actionType: (row.actionType as SecurityIncidentActionRecord["actionType"]) ?? "terminate_session",
    targetType: row.targetType,
    targetId: row.targetId ?? null,
    actorUserId: row.actorUserId ?? null,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
    outcome: (row.outcome as SecurityIncidentActionRecord["outcome"]) ?? "failed",
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function createMysqlIncident(input: SecurityIncidentInsert): Promise<SecurityIncidentRecord> {
  const db = await getMysqlRepositoryDb();
  const now = new Date();
  const id = ulid();
  await db.insert(securityIncidents).values({
    id,
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
  });
  const [row] = await db.select().from(securityIncidents).where(eq(securityIncidents.id, id)).limit(1);
  if (!row) throw new Error("create incident failed");
  return mapIncidentRow(row);
}

export async function getMysqlIncident(tenantId: string, incidentId: string): Promise<SecurityIncidentRecord | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(securityIncidents)
    .where(and(eq(securityIncidents.tenantId, tenantId), eq(securityIncidents.id, incidentId)))
    .limit(1);
  return row ? mapIncidentRow(row) : null;
}

export async function listMysqlIncidents(
  tenantId: string,
  opts?: SecurityIncidentListOptions,
): Promise<SecurityIncidentRecord[]> {
  const db = await getMysqlRepositoryDb();
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

export async function updateMysqlIncidentStatus(input: SecurityIncidentStatusUpdate): Promise<SecurityIncidentRecord | null> {
  const db = await getMysqlRepositoryDb();
  const current = await getMysqlIncident(input.tenantId, input.incidentId);
  if (!current) return null;
  if (!canTransitionIncidentStatus(current.status, input.status)) {
    throw new Error(`illegal incident status transition: ${current.status} -> ${input.status}`);
  }
  if (input.status === "resolved" && !input.resolutionNote?.trim()) {
    throw new Error("resolution note required when resolving an incident");
  }
  const now = new Date();
  const patch: Record<string, unknown> = { status: input.status, updatedAt: now };
  if (input.status === "handling") {
    patch.handledAt = now;
    patch.resolvedAt = null;
    patch.resolutionNote = null;
  }
  if (input.status === "resolved") {
    patch.resolvedAt = now;
    patch.resolutionNote = input.resolutionNote ?? null;
  }
  await db
    .update(securityIncidents)
    .set(patch)
    .where(and(eq(securityIncidents.tenantId, input.tenantId), eq(securityIncidents.id, input.incidentId)));
  return getMysqlIncident(input.tenantId, input.incidentId);
}

export async function insertMysqlIncidentAction(input: SecurityIncidentActionInsert): Promise<SecurityIncidentActionRecord> {
  const db = await getMysqlRepositoryDb();
  const id = ulid();
  await db.insert(securityIncidentActions).values({
    id,
    incidentId: input.incidentId,
    tenantId: input.tenantId,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    actorUserId: input.actorUserId ?? null,
    detail: input.detail ? JSON.stringify(input.detail) : null,
    outcome: input.outcome,
    createdAt: new Date(),
  });
  const [row] = await db.select().from(securityIncidentActions).where(eq(securityIncidentActions.id, id)).limit(1);
  if (!row) throw new Error("insert incident action failed");
  return mapIncidentActionRow(row);
}

export async function listMysqlIncidentActions(tenantId: string, incidentId: string): Promise<SecurityIncidentActionRecord[]> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(securityIncidentActions)
    .where(
      and(
        eq(securityIncidentActions.tenantId, tenantId),
        eq(securityIncidentActions.incidentId, incidentId),
      ),
    )
    .orderBy(asc(securityIncidentActions.createdAt));
  return rows.map(mapIncidentActionRow);
}

export const mysqlSecurityIncidentRepository: SecurityIncidentRepository = {
  dialect: "mysql",
  createIncident: async (input, dbOrTx?: IamDb) => {
    if (dbOrTx) throw new Error("PostgreSQL transaction cannot be passed to MySQL incident repository");
    return createMysqlIncident(input);
  },
  getIncident: async (tenantId, incidentId, dbOrTx?: IamDb) => {
    if (dbOrTx) throw new Error("PostgreSQL transaction cannot be passed to MySQL incident repository");
    return getMysqlIncident(tenantId, incidentId);
  },
  listIncidents: async (tenantId, opts, dbOrTx?: IamDb) => {
    if (dbOrTx) throw new Error("PostgreSQL transaction cannot be passed to MySQL incident repository");
    return listMysqlIncidents(tenantId, opts);
  },
  updateIncidentStatus: async (input, dbOrTx?: IamDb) => {
    if (dbOrTx) throw new Error("PostgreSQL transaction cannot be passed to MySQL incident repository");
    return updateMysqlIncidentStatus(input);
  },
  insertIncidentAction: async (input, dbOrTx?: IamDb) => {
    if (dbOrTx) throw new Error("PostgreSQL transaction cannot be passed to MySQL incident repository");
    return insertMysqlIncidentAction(input);
  },
  listIncidentActions: async (tenantId, incidentId, dbOrTx?: IamDb) => {
    if (dbOrTx) throw new Error("PostgreSQL transaction cannot be passed to MySQL incident repository");
    return listMysqlIncidentActions(tenantId, incidentId);
  },
};

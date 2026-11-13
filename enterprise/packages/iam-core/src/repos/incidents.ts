import { and, desc, eq } from "drizzle-orm";

import type { IamDb } from "../db";
import { resolveDatabaseConfig } from "../database/config";
import { securityIncidentActions, securityIncidents } from "@agenticx/db-schema";
import { ulid } from "ulid";
import type { SecurityIncidentRepository } from "./contracts";
import { mysqlSecurityIncidentRepository } from "./mysql/incidents";
import { postgresqlSecurityIncidentRepository } from "./postgresql/incidents";

/**
 * SP5 incident-response-loop：安全事件记录（三态状态机 open → handling → resolved）。
 * 不做工单系统——三态足够（MASTER-PLAN 第四节第 4 条）。
 */

export type SecurityIncidentStatus = "open" | "handling" | "resolved";

export type SecurityIncidentSeverity = "critical" | "high" | "medium" | "low";

export type SecurityIncidentSource =
  | "manual"
  | "policy_hit"
  | "budget_alert"
  | "chain_check"
  | "moderation";

export type SecurityIncidentActionType =
  | "terminate_session"
  | "revoke_pat"
  | "disable_user"
  | "block_model";

export type SecurityIncidentRecord = {
  id: string;
  tenantId: string;
  title: string;
  source: SecurityIncidentSource;
  severity: SecurityIncidentSeverity;
  status: SecurityIncidentStatus;
  traceId: string | null;
  sessionId: string | null;
  userId: string | null;
  model: string | null;
  summary: string | null;
  createdBy: string | null;
  handledAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SecurityIncidentInsert = {
  tenantId: string;
  title: string;
  source?: SecurityIncidentSource;
  severity?: SecurityIncidentSeverity;
  traceId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  model?: string | null;
  summary?: string | null;
  createdBy?: string | null;
};

export type SecurityIncidentStatusUpdate = {
  tenantId: string;
  incidentId: string;
  status: SecurityIncidentStatus;
  /** handling→resolved 必填结案说明。 */
  resolutionNote?: string | null;
};

export type SecurityIncidentListOptions = {
  status?: SecurityIncidentStatus;
  limit?: number;
};

export type SecurityIncidentActionRecord = {
  id: string;
  incidentId: string;
  tenantId: string;
  actionType: SecurityIncidentActionType;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  detail: Record<string, unknown> | null;
  outcome: "done" | "failed";
  createdAt: string;
};

export type SecurityIncidentActionInsert = {
  incidentId: string;
  tenantId: string;
  actionType: SecurityIncidentActionType;
  targetType: string;
  targetId?: string | null;
  actorUserId?: string | null;
  detail?: Record<string, unknown> | null;
  outcome: "done" | "failed";
};

/** 状态机合法边：open→handling、handling→resolved、resolved→handling（重开留痕）。 */
export const INCIDENT_STATUS_TRANSITIONS: Record<SecurityIncidentStatus, SecurityIncidentStatus[]> = {
  open: ["handling"],
  handling: ["resolved"],
  resolved: ["handling"],
};

export function canTransitionIncidentStatus(
  from: SecurityIncidentStatus,
  to: SecurityIncidentStatus,
): boolean {
  return (INCIDENT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

export function getSecurityIncidentRepository(): SecurityIncidentRepository {
  return resolveDatabaseConfig().dialect === "mysql"
    ? mysqlSecurityIncidentRepository
    : postgresqlSecurityIncidentRepository;
}

export async function createSecurityIncident(
  input: SecurityIncidentInsert,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord> {
  return getSecurityIncidentRepository().createIncident(input, dbOrTx);
}

export async function getSecurityIncident(
  tenantId: string,
  incidentId: string,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord | null> {
  return getSecurityIncidentRepository().getIncident(tenantId, incidentId, dbOrTx);
}

export async function listSecurityIncidents(
  tenantId: string,
  opts?: SecurityIncidentListOptions,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord[]> {
  return getSecurityIncidentRepository().listIncidents(tenantId, opts, dbOrTx);
}

export async function updateSecurityIncidentStatus(
  input: SecurityIncidentStatusUpdate,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentRecord | null> {
  return getSecurityIncidentRepository().updateIncidentStatus(input, dbOrTx);
}

export async function insertSecurityIncidentAction(
  input: SecurityIncidentActionInsert,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentActionRecord> {
  return getSecurityIncidentRepository().insertIncidentAction(input, dbOrTx);
}

export async function listSecurityIncidentActions(
  tenantId: string,
  incidentId: string,
  dbOrTx?: IamDb,
): Promise<SecurityIncidentActionRecord[]> {
  return getSecurityIncidentRepository().listIncidentActions(tenantId, incidentId, dbOrTx);
}

/**
 * 共享行映射（两方言同构；时间戳统一 ISO 字符串）。
 */
export function mapIncidentRow(row: typeof securityIncidents.$inferSelect): SecurityIncidentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    source: (row.source as SecurityIncidentSource) ?? "manual",
    severity: (row.severity as SecurityIncidentSeverity) ?? "high",
    status: (row.status as SecurityIncidentStatus) ?? "open",
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

export function mapIncidentActionRow(
  row: typeof securityIncidentActions.$inferSelect,
): SecurityIncidentActionRecord {
  return {
    id: row.id,
    incidentId: row.incidentId,
    tenantId: row.tenantId,
    actionType: (row.actionType as SecurityIncidentActionType) ?? "terminate_session",
    targetType: row.targetType,
    targetId: row.targetId ?? null,
    actorUserId: row.actorUserId ?? null,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
    outcome: (row.outcome as "done" | "failed") ?? "failed",
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function newIncidentId(): string {
  return ulid();
}

export function incidentWhere(tenantId: string, incidentId?: string) {
  if (incidentId) {
    return and(
      eq(securityIncidents.tenantId, tenantId),
      eq(securityIncidents.id, incidentId),
    );
  }
  return eq(securityIncidents.tenantId, tenantId);
}

export function incidentOrder() {
  return desc(securityIncidents.createdAt);
}

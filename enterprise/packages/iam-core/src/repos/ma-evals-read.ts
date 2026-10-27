import {
  maEvalCandidates as pgCandidates,
  maEvalResults as pgResults,
  maEvalRuns as pgRuns,
} from "@agenticx/db-schema";
import {
  maEvalCandidates as mysqlCandidates,
  maEvalResults as mysqlResults,
  maEvalRuns as mysqlRuns,
} from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq, lt, or } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { getMysqlRepositoryDb } from "./mysql/db";

export type EvalRunRecord = {
  id: string;
  tenantId: string;
  kind: "eval" | "iterate";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  agentId: string;
  agentVersion: number;
  environmentId: string | null;
  datasetId: string | null;
  datasetName: string;
  datasetHash: string;
  rubricId: string | null;
  rubricName: string;
  rubricVersion: number;
  rubricHash: string;
  baseRunId: string | null;
  config: Record<string, unknown>;
  progress: Record<string, number>;
  summary: Record<string, unknown>;
  error: string | null;
  createdBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type EvalResultRecord = {
  id: string;
  runId: string;
  itemId: string;
  position: number;
  status: "passed" | "failed" | "error";
  scoreMilli: number | null;
  sessionId: string | null;
  answer: string | null;
  toolNames: string[];
  stopReason: string | null;
  ruleResults: { type: string; passed: boolean; detail: string }[];
  judge: { score: number; passed: boolean; reason: string; error: string | null } | null;
  usage: Record<string, number>;
  durationMs: number;
  error: string | null;
};

export type EvalCandidateRecord = {
  id: string;
  tenantId: string;
  runId: string;
  baseRunId: string;
  agentId: string;
  baseVersion: number;
  manifest: Record<string, unknown>;
  manifestHash: string;
  diff: { system?: string };
  rationale: string | null;
  status: "proposed" | "applied" | "discarded";
  appliedVersion: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function nullableIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  return iso(value);
}

function asJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value == null) return fallback;
  return value as T;
}

function field(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

function mapRun(row: Record<string, unknown>): EvalRunRecord {
  const kind = String(field(row, "kind"));
  const status = String(field(row, "status"));
  return {
    id: String(field(row, "id")),
    tenantId: String(field(row, "tenantId")),
    kind: kind === "iterate" ? "iterate" : "eval",
    status: status as EvalRunRecord["status"],
    agentId: String(field(row, "agentId")),
    agentVersion: Number(field(row, "agentVersion")),
    environmentId: field(row, "environmentId") == null ? null : String(field(row, "environmentId")),
    datasetId: field(row, "datasetId") == null ? null : String(field(row, "datasetId")),
    datasetName: String(field(row, "datasetName")),
    datasetHash: String(field(row, "datasetHash")),
    rubricId: field(row, "rubricId") == null ? null : String(field(row, "rubricId")),
    rubricName: String(field(row, "rubricName")),
    rubricVersion: Number(field(row, "rubricVersion")),
    rubricHash: String(field(row, "rubricHash")),
    baseRunId: field(row, "baseRunId") == null ? null : String(field(row, "baseRunId")),
    config: asJson(field(row, "config"), {}),
    progress: asJson(field(row, "progress"), {}),
    summary: asJson(field(row, "summary"), {}),
    error: field(row, "error") == null ? null : String(field(row, "error")),
    createdBy: field(row, "createdBy") == null ? null : String(field(row, "createdBy")),
    startedAt: nullableIso(field(row, "startedAt")),
    finishedAt: nullableIso(field(row, "finishedAt")),
    createdAt: iso(field(row, "createdAt")),
  };
}

function mapResult(row: Record<string, unknown>): EvalResultRecord {
  const status = String(field(row, "status"));
  return {
    id: String(field(row, "id")),
    runId: String(field(row, "runId")),
    itemId: String(field(row, "itemId")),
    position: Number(field(row, "position")),
    status: status as EvalResultRecord["status"],
    scoreMilli: field(row, "scoreMilli") == null ? null : Number(field(row, "scoreMilli")),
    sessionId: field(row, "sessionId") == null ? null : String(field(row, "sessionId")),
    answer: field(row, "answer") == null ? null : String(field(row, "answer")),
    toolNames: asJson(field(row, "toolNames"), []),
    stopReason: field(row, "stopReason") == null ? null : String(field(row, "stopReason")),
    ruleResults: asJson(field(row, "ruleResults"), []),
    judge: asJson(field(row, "judge"), null),
    usage: asJson(field(row, "usage"), {}),
    durationMs: Number(field(row, "durationMs") ?? 0),
    error: field(row, "error") == null ? null : String(field(row, "error")),
  };
}

function mapCandidate(row: Record<string, unknown>): EvalCandidateRecord {
  const status = String(field(row, "status"));
  return {
    id: String(field(row, "id")),
    tenantId: String(field(row, "tenantId")),
    runId: String(field(row, "runId")),
    baseRunId: String(field(row, "baseRunId")),
    agentId: String(field(row, "agentId")),
    baseVersion: Number(field(row, "baseVersion")),
    manifest: asJson(field(row, "manifest"), {}),
    manifestHash: String(field(row, "manifestHash")),
    diff: asJson(field(row, "diff"), {}),
    rationale: field(row, "rationale") == null ? null : String(field(row, "rationale")),
    status: status as EvalCandidateRecord["status"],
    appliedVersion: field(row, "appliedVersion") == null ? null : Number(field(row, "appliedVersion")),
    decidedBy: field(row, "decidedBy") == null ? null : String(field(row, "decidedBy")),
    decidedAt: nullableIso(field(row, "decidedAt")),
    createdAt: iso(field(row, "createdAt")),
  };
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

export async function listEvalRuns(
  tenantId: string,
  filter?: { agentId?: string; limit?: number; cursor?: string | null },
): Promise<{ items: EvalRunRecord[]; nextCursor: string | null }> {
  const limit = clamp(filter?.limit, 50, 100);
  const cursor = filter?.cursor ? decodeCursor(filter.cursor) : null;
  const rows = isMysql()
    ? await listMysqlRuns(tenantId, filter?.agentId, cursor, limit)
    : await listPgRuns(tenantId, filter?.agentId, cursor, limit);
  const items = (rows as Record<string, unknown>[]).map(mapRun);
  const next = items.length === limit ? items[items.length - 1] : undefined;
  return { items, nextCursor: next ? encodeCursor(next.createdAt, next.id) : null };
}

async function listPgRuns(
  tenantId: string,
  agentId: string | undefined,
  cursor: { createdAt: string; id: string } | null,
  limit: number,
) {
  const filters = [eq(pgRuns.tenantId, tenantId)];
  if (agentId) filters.push(eq(pgRuns.agentId, agentId));
  if (cursor) {
    filters.push(
      or(
        lt(pgRuns.createdAt, new Date(cursor.createdAt)),
        and(eq(pgRuns.createdAt, new Date(cursor.createdAt)), lt(pgRuns.id, cursor.id)),
      )!,
    );
  }
  return getIamDb()
    .select()
    .from(pgRuns)
    .where(and(...filters))
    .orderBy(desc(pgRuns.createdAt), desc(pgRuns.id))
    .limit(limit);
}

async function listMysqlRuns(
  tenantId: string,
  agentId: string | undefined,
  cursor: { createdAt: string; id: string } | null,
  limit: number,
) {
  const db = await getMysqlRepositoryDb();
  const filters = [eq(mysqlRuns.tenantId, tenantId)];
  if (agentId) filters.push(eq(mysqlRuns.agentId, agentId));
  if (cursor) {
    filters.push(
      or(
        lt(mysqlRuns.createdAt, new Date(cursor.createdAt)),
        and(eq(mysqlRuns.createdAt, new Date(cursor.createdAt)), lt(mysqlRuns.id, cursor.id)),
      )!,
    );
  }
  return db
    .select()
    .from(mysqlRuns)
    .where(and(...filters))
    .orderBy(desc(mysqlRuns.createdAt), desc(mysqlRuns.id))
    .limit(limit);
}

export async function getEvalRun(tenantId: string, id: string): Promise<EvalRunRecord | null> {
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlRuns)
        .where(and(eq(mysqlRuns.tenantId, tenantId), eq(mysqlRuns.id, id)))
        .limit(1)
    : await getIamDb()
        .select()
        .from(pgRuns)
        .where(and(eq(pgRuns.tenantId, tenantId), eq(pgRuns.id, id)))
        .limit(1);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapRun(row) : null;
}

export async function listEvalResults(
  tenantId: string,
  runId: string,
  filter?: { status?: string; limit?: number; offset?: number },
): Promise<EvalResultRecord[]> {
  const limit = clamp(filter?.limit, 100, 500);
  const offset = Math.max(0, Math.trunc(filter?.offset ?? 0));
  const status = filter?.status;
  const rows = isMysql()
    ? await (async () => {
        const db = await getMysqlRepositoryDb();
        const filters = [eq(mysqlResults.tenantId, tenantId), eq(mysqlResults.runId, runId)];
        if (status) filters.push(eq(mysqlResults.status, status));
        return db
          .select()
          .from(mysqlResults)
          .where(and(...filters))
          .orderBy(asc(mysqlResults.position))
          .limit(limit)
          .offset(offset);
      })()
    : await (async () => {
        const filters = [eq(pgResults.tenantId, tenantId), eq(pgResults.runId, runId)];
        if (status) filters.push(eq(pgResults.status, status));
        return getIamDb()
          .select()
          .from(pgResults)
          .where(and(...filters))
          .orderBy(asc(pgResults.position))
          .limit(limit)
          .offset(offset);
      })();
  return (rows as Record<string, unknown>[]).map(mapResult);
}

export async function listEvalCandidates(
  tenantId: string,
  filter?: { agentId?: string },
): Promise<EvalCandidateRecord[]> {
  const rows = isMysql()
    ? await (async () => {
        const db = await getMysqlRepositoryDb();
        const filters = [eq(mysqlCandidates.tenantId, tenantId)];
        if (filter?.agentId) filters.push(eq(mysqlCandidates.agentId, filter.agentId));
        return db
          .select()
          .from(mysqlCandidates)
          .where(and(...filters))
          .orderBy(desc(mysqlCandidates.createdAt));
      })()
    : await (async () => {
        const filters = [eq(pgCandidates.tenantId, tenantId)];
        if (filter?.agentId) filters.push(eq(pgCandidates.agentId, filter.agentId));
        return getIamDb()
          .select()
          .from(pgCandidates)
          .where(and(...filters))
          .orderBy(desc(pgCandidates.createdAt));
      })();
  return (rows as Record<string, unknown>[]).map(mapCandidate);
}

export async function getEvalCandidate(tenantId: string, id: string): Promise<EvalCandidateRecord | null> {
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlCandidates)
        .where(and(eq(mysqlCandidates.tenantId, tenantId), eq(mysqlCandidates.id, id)))
        .limit(1)
    : await getIamDb()
        .select()
        .from(pgCandidates)
        .where(and(eq(pgCandidates.tenantId, tenantId), eq(pgCandidates.id, id)))
        .limit(1);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapCandidate(row) : null;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(value: string): { createdAt: string; id: string } | null {
  try {
    const text = Buffer.from(value, "base64url").toString("utf8");
    const split = text.lastIndexOf("|");
    if (split <= 0) return null;
    return { createdAt: text.slice(0, split), id: text.slice(split + 1) };
  } catch {
    return null;
  }
}

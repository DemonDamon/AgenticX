import { maMemoryDreams as pgDreams } from "@agenticx/db-schema";
import { maMemoryDreams as mysqlDreams } from "@agenticx/db-schema/mysql";
import { and, desc, eq } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { getMysqlRepositoryDb } from "./mysql/db";

export type MemoryDreamStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type MemoryDreamRecord = {
  id: string;
  tenant_id: string;
  status: MemoryDreamStatus;
  input_memory_store_id: string;
  output_memory_store_id: string;
  session_ids: string[];
  model: string;
  instructions: string;
  report: Record<string, unknown>;
  error: { type: string; message: string } | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const STATUSES: readonly MemoryDreamStatus[] = ["pending", "running", "completed", "failed", "cancelled"];

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

function asStatus(value: unknown): MemoryDreamStatus {
  const text = String(value ?? "");
  if ((STATUSES as readonly string[]).includes(text)) return text as MemoryDreamStatus;
  return "failed";
}

function asError(value: unknown): { type: string; message: string } | null {
  const parsed = asJson<unknown>(value, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== "string" || typeof record.message !== "string") return null;
  return { type: record.type, message: record.message };
}

function mapDream(row: Record<string, unknown>): MemoryDreamRecord {
  const sessionIds = asJson<unknown>(field(row, "sessionIds"), []);
  return {
    id: String(field(row, "id")),
    tenant_id: String(field(row, "tenantId")),
    status: asStatus(field(row, "status")),
    input_memory_store_id: String(field(row, "inputMemoryStoreId")),
    output_memory_store_id: String(field(row, "outputMemoryStoreId")),
    session_ids: Array.isArray(sessionIds) ? sessionIds.filter((item): item is string => typeof item === "string") : [],
    model: String(field(row, "model")),
    instructions: String(field(row, "instructions")),
    report: asJson<Record<string, unknown>>(field(row, "report"), {}),
    error: asError(field(row, "error")),
    created_by: field(row, "createdBy") == null ? null : String(field(row, "createdBy")),
    started_at: nullableIso(field(row, "startedAt")),
    finished_at: nullableIso(field(row, "finishedAt")),
    created_at: iso(field(row, "createdAt")),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

export async function listMemoryDreams(
  tenantId: string,
  opts?: { inputStoreId?: string; limit?: number },
): Promise<MemoryDreamRecord[]> {
  const limit = clampLimit(opts?.limit);
  const inputStoreId = opts?.inputStoreId;
  if (isMysql()) {
    const db = await getMysqlRepositoryDb();
    const filters = [eq(mysqlDreams.tenantId, tenantId)];
    if (inputStoreId) filters.push(eq(mysqlDreams.inputMemoryStoreId, inputStoreId));
    const rows = await db
      .select()
      .from(mysqlDreams)
      .where(and(...filters))
      .orderBy(desc(mysqlDreams.createdAt), desc(mysqlDreams.id))
      .limit(limit);
    return (rows as Record<string, unknown>[]).map(mapDream);
  }
  const filters = [eq(pgDreams.tenantId, tenantId)];
  if (inputStoreId) filters.push(eq(pgDreams.inputMemoryStoreId, inputStoreId));
  const rows = await getIamDb()
    .select()
    .from(pgDreams)
    .where(and(...filters))
    .orderBy(desc(pgDreams.createdAt), desc(pgDreams.id))
    .limit(limit);
  return (rows as Record<string, unknown>[]).map(mapDream);
}

export async function getMemoryDream(tenantId: string, id: string): Promise<MemoryDreamRecord | null> {
  if (isMysql()) {
    const db = await getMysqlRepositoryDb();
    const rows = await db
      .select()
      .from(mysqlDreams)
      .where(and(eq(mysqlDreams.tenantId, tenantId), eq(mysqlDreams.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? mapDream(row as Record<string, unknown>) : null;
  }
  const rows = await getIamDb()
    .select()
    .from(pgDreams)
    .where(and(eq(pgDreams.tenantId, tenantId), eq(pgDreams.id, id)))
    .limit(1);
  const row = rows[0];
  return row ? mapDream(row as Record<string, unknown>) : null;
}

import { and, asc, eq } from "drizzle-orm";
import { agentTokenTraces as pgTraces } from "@agenticx/db-schema";
import { agentTokenTraces as mysqlTraces } from "@agenticx/db-schema/mysql";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { getAdminMysqlDb } from "./db-stores/mysql/database";
import type { AgentTraceSpanRow } from "./agent-trace-store";

/** Tenant-scoped model step lookup (does not fall back to DEFAULT_TENANT_ID). */
export async function getAgentTraceSpansByTenant(
  tenantId: string,
  traceId: string,
): Promise<AgentTraceSpanRow[]> {
  const tid = tenantId.trim();
  const tr = traceId.trim();
  if (!tid || !tr) return [];

  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql": {
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTraces)
        .where(and(eq(pgTraces.tenantId, tid), eq(pgTraces.traceId, tr)))
        .orderBy(asc(pgTraces.stepNo));
      return rows.map((row) => ({
        id: row.id,
        trace_id: row.traceId,
        step_no: row.stepNo,
        step_kind: row.stepKind,
        status: row.status,
        model: row.model,
        provider: row.provider,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        total_tokens: row.totalTokens,
        cost_usd: String(row.costUsd ?? "0"),
        duration_ms: row.durationMs,
        error_message: row.errorMessage,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        created_at: row.createdAt,
      }));
    }
    case "mysql": {
      const db = getAdminMysqlDb();
      const rows = await db
        .select()
        .from(mysqlTraces)
        .where(and(eq(mysqlTraces.tenantId, tid), eq(mysqlTraces.traceId, tr)))
        .orderBy(asc(mysqlTraces.stepNo));
      return rows.map((row) => ({
        id: row.id,
        trace_id: row.traceId,
        step_no: row.stepNo,
        step_kind: row.stepKind,
        status: row.status,
        model: row.model,
        provider: row.provider,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        total_tokens: row.totalTokens,
        cost_usd: String(row.costUsd ?? "0"),
        duration_ms: row.durationMs,
        error_message: row.errorMessage,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        created_at: row.createdAt,
      }));
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

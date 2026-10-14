/**
 * Desktop PAT ingest for agent_token_traces.
 *
 * PostgreSQL uses ON CONFLICT DO NOTHING. MySQL uses INSERT IGNORE.
 * A retry with the same (tenant, trace, step) does not overwrite an existing row.
 */

import { agentTokenTraces as pgAgentTokenTraces } from "@agenticx/db-schema";
import { agentTokenTraces as mysqlAgentTokenTraces } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { ulid } from "ulid";

export type DesktopTraceStepKind = "model" | "tool" | "subagent" | "run";
export type DesktopTraceStatus = "ok" | "error" | "cancelled";

export type DesktopTraceSpan = {
  trace_id: string;
  step_no: number;
  step_kind: DesktopTraceStepKind;
  status: DesktopTraceStatus;
  model?: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  duration_ms: number;
  cost_usd: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
};

const PG_INT_MAX = 2_147_483_647;

function clampInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > PG_INT_MAX) return PG_INT_MAX;
  return Math.floor(value);
}

function spanMetadata(userId: string, metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    user_id: userId,
    source: "near",
  };
}

function toRow(tenantId: string, userId: string, span: DesktopTraceSpan) {
  return {
    id: ulid(),
    tenantId,
    traceId: span.trace_id,
    stepNo: span.step_no,
    stepKind: span.step_kind,
    status: span.status,
    model: span.model?.trim() ? span.model.trim().slice(0, 128) : null,
    provider: span.provider?.trim() ? span.provider.trim().slice(0, 64) : null,
    inputTokens: clampInt(span.input_tokens),
    outputTokens: clampInt(span.output_tokens),
    reasoningTokens: clampInt(span.reasoning_tokens),
    totalTokens: clampInt(span.total_tokens),
    costUsd: String(clampInt(span.cost_usd)),
    durationMs: clampInt(span.duration_ms),
    errorMessage: span.error_message?.slice(0, 2000) ?? null,
    metadata: spanMetadata(userId, span.metadata),
  };
}

export async function insertDesktopAgentTraces(input: {
  tenantId: string;
  userId: string;
  spans: DesktopTraceSpan[];
}): Promise<number> {
  if (input.spans.length === 0) return 0;
  const rows = input.spans.map((span) => toRow(input.tenantId, input.userId, span));
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    await db.insert(mysqlAgentTokenTraces).ignore().values(rows);
  } else {
    const db = getIamDb();
    await db
      .insert(pgAgentTokenTraces)
      .values(rows)
      .onConflictDoNothing({
        target: [pgAgentTokenTraces.tenantId, pgAgentTokenTraces.traceId, pgAgentTokenTraces.stepNo],
      });
  }
  return rows.length;
}

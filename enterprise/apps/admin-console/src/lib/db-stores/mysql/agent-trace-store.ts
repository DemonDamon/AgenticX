import { getAdminMysqlDb } from "./database";
import { and, asc, desc, eq } from "drizzle-orm";
import { agentTokenTraces } from "@agenticx/db-schema/mysql";

const FALLBACK_TENANT_ID = "01J00000000000000000000001";

function resolveTenantId(): string {
  const value = process.env.DEFAULT_TENANT_ID?.trim();
  return value && value.length > 0 ? value : FALLBACK_TENANT_ID;
}

export type AgentTraceSpanRow = {
  id: string;
  trace_id: string;
  step_no: number;
  step_kind: string;
  status: string;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: string;
  duration_ms: number;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

export type AgentTraceDetail = {
  trace_id: string;
  spans: AgentTraceSpanRow[];
  total_usage: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
  status: string;
};

export async function listAgentTraceIds(limit = 50): Promise<string[]> {
  const db = getAdminMysqlDb();
  const tenantId = resolveTenantId();
  const rows = await db
    .selectDistinct({ traceId: agentTokenTraces.traceId })
    .from(agentTokenTraces)
    .where(eq(agentTokenTraces.tenantId, tenantId))
    .orderBy(desc(agentTokenTraces.createdAt))
    .limit(limit);
  return rows.map((row) => row.traceId);
}

export async function getAgentTrace(traceId: string): Promise<AgentTraceDetail | null> {
  const db = getAdminMysqlDb();
  const tenantId = resolveTenantId();
  const rows = await db
    .select()
    .from(agentTokenTraces)
    .where(and(eq(agentTokenTraces.tenantId, tenantId), eq(agentTokenTraces.traceId, traceId)))
    .orderBy(asc(agentTokenTraces.stepNo));
  if (rows.length === 0) return null;

  const spans: AgentTraceSpanRow[] = rows.map((row) => ({
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

  const total = spans.reduce(
    (acc, span) => {
      acc.input_tokens += span.input_tokens;
      acc.output_tokens += span.output_tokens;
      acc.reasoning_tokens += span.reasoning_tokens;
      acc.total_tokens += span.total_tokens;
      acc.cost_usd += Number(span.cost_usd);
      return acc;
    },
    { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0, cost_usd: 0 }
  );

  const status = spans.some((span) => span.status !== "ok") ? spans.find((s) => s.status !== "ok")!.status : "ok";
  return { trace_id: traceId, spans, total_usage: total, status };
}

export async function ingestAgentTraceSpans(
  spans: Array<{
    id?: string;
    trace_id: string;
    step_no: number;
    step_kind: string;
    status: string;
    model?: string | null;
    provider?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
    duration_ms?: number;
    error_message?: string | null;
    metadata?: Record<string, unknown> | null;
  }>
) {
  const db = getAdminMysqlDb();
  const tenantId = resolveTenantId();
  for (const span of spans) {
    const id = span.id?.trim() || `trace_${span.trace_id}_${span.step_no}`;
    await db
      .insert(agentTokenTraces)
      .values({
        id,
        tenantId,
        traceId: span.trace_id,
        stepNo: span.step_no,
        stepKind: span.step_kind,
        status: span.status,
        model: span.model ?? null,
        provider: span.provider ?? null,
        inputTokens: span.input_tokens ?? 0,
        outputTokens: span.output_tokens ?? 0,
        reasoningTokens: span.reasoning_tokens ?? 0,
        totalTokens: span.total_tokens ?? 0,
        costUsd: String(span.cost_usd ?? 0),
        durationMs: span.duration_ms ?? 0,
        errorMessage: span.error_message ?? null,
        metadata: span.metadata ?? null,
      })
      .onDuplicateKeyUpdate({
        set: {
          stepKind: span.step_kind,
          status: span.status,
          model: span.model ?? null,
          provider: span.provider ?? null,
          inputTokens: span.input_tokens ?? 0,
          outputTokens: span.output_tokens ?? 0,
          reasoningTokens: span.reasoning_tokens ?? 0,
          totalTokens: span.total_tokens ?? 0,
          costUsd: String(span.cost_usd ?? 0),
          durationMs: span.duration_ms ?? 0,
          errorMessage: span.error_message ?? null,
          metadata: span.metadata ?? null,
          updatedAt: new Date(),
        },
      });
  }
}

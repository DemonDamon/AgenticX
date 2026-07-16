import { index, int, json, decimal, mysqlTable, text, datetime, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { auditColumns } from "./_shared";

export const agentTokenTraces = mysqlTable(
  "agent_token_traces",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    traceId: varchar("trace_id", { length: 128 }).notNull(),
    stepNo: int("step_no").notNull(),
    stepKind: varchar("step_kind", { length: 32 }).notNull().default("model"),
    status: varchar("status", { length: 16 }).notNull().default("ok"),
    model: varchar("model", { length: 128 }),
    provider: varchar("provider", { length: 64 }),
    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    reasoningTokens: int("reasoning_tokens").notNull().default(0),
    totalTokens: int("total_tokens").notNull().default(0),
    costUsd: decimal("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    durationMs: int("duration_ms").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: json("metadata"),
    ...auditColumns,
  },
  (table) => ({
    traceStepUq: uniqueIndex("agent_token_traces_trace_step_uq").on(table.tenantId, table.traceId, table.stepNo),
    traceIdx: index("agent_token_traces_trace_idx").on(table.tenantId, table.traceId),
  })
);

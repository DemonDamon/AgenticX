-- Agent token trace spans for edge-agent sandbox debugging
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "trace_id" varchar(128);
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "trace_step" integer;

CREATE TABLE IF NOT EXISTS "agent_token_traces" (
  "id" varchar(64) PRIMARY KEY,
  "tenant_id" varchar(64) NOT NULL,
  "trace_id" varchar(128) NOT NULL,
  "step_no" integer NOT NULL,
  "step_kind" varchar(32) NOT NULL DEFAULT 'model',
  "status" varchar(16) NOT NULL DEFAULT 'ok',
  "model" varchar(128),
  "provider" varchar(64),
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "reasoning_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "cost_usd" numeric(18, 8) NOT NULL DEFAULT 0,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_token_traces_trace_step_uq"
  ON "agent_token_traces" ("tenant_id", "trace_id", "step_no");
CREATE INDEX IF NOT EXISTS "agent_token_traces_trace_idx"
  ON "agent_token_traces" ("tenant_id", "trace_id");

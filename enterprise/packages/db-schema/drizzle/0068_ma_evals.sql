-- Managed Agents 评测与自迭代。
-- 写入方：ma_eval_datasets / ma_eval_dataset_items / ma_eval_rubrics = admin-console；
--         ma_eval_runs / ma_eval_results / ma_eval_candidates = agent-runtime（admin-console 只读）。
-- 分数以千分制整数 score_milli 存储（0..1000）。
CREATE TABLE IF NOT EXISTS "ma_eval_datasets" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(128) NOT NULL,
  "description" varchar(1024),
  "item_count" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_datasets_tenant_name_uq" ON "ma_eval_datasets" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_dataset_items" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "dataset_id" varchar(26) NOT NULL REFERENCES "ma_eval_datasets"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "query" text NOT NULL,
  "expected_answer" text,
  "expected_tool_trace" jsonb,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_session_id" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_dataset_items_dataset_position_uq" ON "ma_eval_dataset_items" ("dataset_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_rubrics" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(128) NOT NULL,
  "description" varchar(1024),
  "version" integer DEFAULT 1 NOT NULL,
  "content" jsonb NOT NULL,
  "content_hash" varchar(80) NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_rubrics_tenant_name_uq" ON "ma_eval_rubrics" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_runs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "agent_id" varchar(26) NOT NULL,
  "agent_version" integer NOT NULL,
  "environment_id" varchar(26),
  "dataset_id" varchar(26),
  "dataset_name" varchar(128) NOT NULL,
  "dataset_hash" varchar(80) NOT NULL,
  "rubric_id" varchar(26),
  "rubric_name" varchar(128) NOT NULL,
  "rubric_version" integer NOT NULL,
  "rubric_hash" varchar(80) NOT NULL,
  "base_run_id" varchar(26),
  "config" jsonb NOT NULL,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "created_by" varchar(26),
  "claimed_by" varchar(64),
  "heartbeat_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_runs_tenant_created_idx" ON "ma_eval_runs" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_runs_status_created_idx" ON "ma_eval_runs" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_runs_tenant_agent_idx" ON "ma_eval_runs" ("tenant_id", "agent_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_results" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "run_id" varchar(26) NOT NULL REFERENCES "ma_eval_runs"("id") ON DELETE CASCADE,
  "item_id" varchar(26) NOT NULL,
  "position" integer NOT NULL,
  "status" varchar(16) NOT NULL,
  "score_milli" integer,
  "session_id" varchar(26),
  "answer" text,
  "tool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "stop_reason" varchar(32),
  "rule_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "judge" jsonb,
  "usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_results_run_item_uq" ON "ma_eval_results" ("run_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_results_run_position_idx" ON "ma_eval_results" ("run_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_candidates" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "run_id" varchar(26) NOT NULL REFERENCES "ma_eval_runs"("id") ON DELETE CASCADE,
  "base_run_id" varchar(26) NOT NULL,
  "agent_id" varchar(26) NOT NULL,
  "base_version" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_hash" varchar(80) NOT NULL,
  "diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rationale" text,
  "status" varchar(16) DEFAULT 'proposed' NOT NULL,
  "applied_version" integer,
  "decided_by" varchar(26),
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_candidates_tenant_agent_idx" ON "ma_eval_candidates" ("tenant_id", "agent_id", "created_at");

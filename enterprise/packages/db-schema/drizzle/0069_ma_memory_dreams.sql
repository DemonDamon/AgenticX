-- Managed Agents 记忆整理任务。唯一写入方：agent-runtime；admin-console 只读。
-- 输出记忆库本身仍由 admin-console 写入（经 /api/internal/ma/memory-stores/* 内部接口）。
CREATE TABLE IF NOT EXISTS "ma_memory_dreams" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "input_memory_store_id" varchar(26) NOT NULL,
  "output_memory_store_id" varchar(26) NOT NULL,
  "session_ids" jsonb NOT NULL,
  "instructions" text NOT NULL,
  "model" varchar(160) NOT NULL,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" jsonb,
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "created_by" varchar(26),
  "claimed_by" varchar(64),
  "heartbeat_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_dreams_tenant_created_idx" ON "ma_memory_dreams" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_dreams_status_created_idx" ON "ma_memory_dreams" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_dreams_tenant_input_idx" ON "ma_memory_dreams" ("tenant_id", "input_memory_store_id", "created_at");

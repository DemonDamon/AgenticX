-- 桌面执行任务队列。worker_keys 空数组表示没有员工能承接。
-- 任务状态：queued / claimed / completed / failed / expired。

ALTER TABLE "enterprise_agents" ADD COLUMN IF NOT EXISTS "worker_keys" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_agent_workers" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "user_id" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" varchar(64) NOT NULL,
  "device_name" varchar(128) NOT NULL,
  "last_heartbeat_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_agent_workers_agent_user_device_uq"
  ON "enterprise_agent_workers" ("agent_id", "user_id", "device_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_agent_tasks" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "room_id" varchar(26) NOT NULL REFERENCES "enterprise_collab_rooms"("id") ON DELETE CASCADE,
  "trigger_message_id" varchar(26) NOT NULL,
  "requested_by" varchar(26) NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "input" jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claimed_by_user_id" varchar(26),
  "claimed_by_device" varchar(64),
  "claimed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "result_message_id" varchar(26),
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_agent_tasks_queue_idx"
  ON "enterprise_agent_tasks" ("tenant_id", "agent_id", "status", "created_at");

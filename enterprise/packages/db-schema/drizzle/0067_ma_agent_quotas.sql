-- 托管智能体「用户 × 智能体」token 配额。唯一写入方 admin-console；agent-runtime 经 /api/internal/ma/agent-quotas/effective 读取。
CREATE TABLE IF NOT EXISTS "ma_agent_quotas" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "subject_key" varchar(40) NOT NULL,
  "user_id" varchar(26),
  "daily_tokens" bigint DEFAULT 0 NOT NULL,
  "weekly_tokens" bigint DEFAULT 0 NOT NULL,
  "monthly_tokens" bigint DEFAULT 0 NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_agent_quotas_subject_uq" ON "ma_agent_quotas" ("tenant_id", "agent_id", "subject_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_session_usage_quota_idx" ON "ma_session_usage" ("tenant_id", "agent_id", "user_id", "created_at");

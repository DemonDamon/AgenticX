-- 租户级本机智能体动作策略。
CREATE TABLE IF NOT EXISTS "enterprise_desktop_agent_policies" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  "config" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

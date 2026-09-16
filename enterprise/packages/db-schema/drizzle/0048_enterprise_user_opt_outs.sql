-- 个人关闭记录：能力（mcp:/skill:）与模型（model:）同一处存。fresh install 不搬过渡数据。

CREATE TABLE IF NOT EXISTS "enterprise_user_opt_outs" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" varchar(64) NOT NULL,
  "subject" varchar(256) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_user_opt_outs_pk" PRIMARY KEY ("tenant_id", "user_id", "subject")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_user_opt_outs_tenant_user_idx"
  ON "enterprise_user_opt_outs" ("tenant_id", "user_id");

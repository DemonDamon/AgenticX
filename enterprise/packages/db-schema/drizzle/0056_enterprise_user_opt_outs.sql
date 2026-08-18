-- 个人关闭记录合并成一张表：能力（mcp:/skill:）与模型（model:）同一种事，同一处存。
-- 旧的 enterprise_capability_opt_outs 只承载能力，配额 JSON 的 modelExclusions 承载
-- 模型且没有外键；后者由应用侧惰性迁移搬进来。

CREATE TABLE IF NOT EXISTS "enterprise_user_opt_outs" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" varchar(64) NOT NULL,
  "subject" varchar(256) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_user_opt_outs_pk" PRIMARY KEY ("tenant_id", "user_id", "subject")
);
CREATE INDEX IF NOT EXISTS "enterprise_user_opt_outs_tenant_user_idx"
  ON "enterprise_user_opt_outs" ("tenant_id", "user_id");

INSERT INTO "enterprise_user_opt_outs" ("tenant_id", "user_id", "subject")
SELECT "tenant_id", "user_id", "capability_id" FROM "enterprise_capability_opt_outs"
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS "enterprise_capability_opt_outs";

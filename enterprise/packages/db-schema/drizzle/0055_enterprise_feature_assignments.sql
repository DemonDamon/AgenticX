-- 功能级分配（联网搜索 / 深度研究）：与可见模型、能力包共用同一套分配键。
-- 没有任何行 = 全员可用；一旦有行，就只有命中的人可用。

CREATE TABLE IF NOT EXISTS "enterprise_feature_assignments" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "feature" varchar(64) NOT NULL,
  "assignment_key" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_feature_assignments_pk" PRIMARY KEY ("tenant_id", "feature", "assignment_key")
);
CREATE INDEX IF NOT EXISTS "enterprise_feature_assignments_tenant_feature_idx"
  ON "enterprise_feature_assignments" ("tenant_id", "feature");

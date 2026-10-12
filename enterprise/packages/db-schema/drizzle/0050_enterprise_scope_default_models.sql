-- 部门默认模型。一行一个 dept:<id>。

CREATE TABLE IF NOT EXISTS "enterprise_runtime_scope_default_models" (
  "tenant_id" varchar(26) NOT NULL,
  "assignment_key" text NOT NULL,
  "model_id" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_runtime_scope_default_pk" PRIMARY KEY ("tenant_id", "assignment_key")
);

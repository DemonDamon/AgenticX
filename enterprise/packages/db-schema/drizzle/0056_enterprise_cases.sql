-- 企业案例库。未发布的案例只有提交人和案例管理员可见。

CREATE TABLE IF NOT EXISTS "enterprise_cases" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" varchar(128) NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "source_repo" varchar(512) DEFAULT '' NOT NULL,
  "status" varchar(16) DEFAULT 'submitted' NOT NULL,
  "submitter_user_id" varchar(26) NOT NULL,
  "manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "package_path" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_cases_tenant_status_idx"
  ON "enterprise_cases" ("tenant_id", "status");

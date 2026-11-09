CREATE TABLE IF NOT EXISTS "enterprise_runtime_virtual_models" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "name" varchar(128) NOT NULL,
  "display_name" varchar(256) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_runtime_vm_tenant_name_uk"
  ON "enterprise_runtime_virtual_models" ("tenant_id", "name");

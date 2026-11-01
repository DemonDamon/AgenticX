-- ECP E4: expert_package manifest, install copies, tenant distribution policy.

ALTER TABLE "platform_catalog_item_versions" ADD COLUMN IF NOT EXISTS "pack_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "install_copy_of" varchar(64);
--> statement-breakpoint
ALTER TABLE "enterprise_capability_packs" ADD COLUMN IF NOT EXISTS "origin" varchar(16) DEFAULT 'tenant' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise_capability_packs" ADD COLUMN IF NOT EXISTS "platform_catalog_item_id" varchar(26);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_capability_packs_platform_catalog_idx"
  ON "enterprise_capability_packs" ("tenant_id", "platform_catalog_item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ecp_tenant_settings" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "install_copy_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

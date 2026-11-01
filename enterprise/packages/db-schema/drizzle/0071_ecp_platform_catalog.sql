-- ECP E1: platform catalog + tenant distribution grants; enterprise_skills origin columns.

CREATE TABLE IF NOT EXISTS "platform_catalog_items" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "slug" varchar(128) NOT NULL,
  "display_name" varchar(128),
  "description" text,
  "resource_type" varchar(32) DEFAULT 'skill' NOT NULL,
  "version" varchar(32) DEFAULT '0.0.0' NOT NULL,
  "bundle_uri" text,
  "bundle_digest" varchar(128),
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_catalog_items_slug_uq"
  ON "platform_catalog_items" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_catalog_items_status_idx"
  ON "platform_catalog_items" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_distribution_grants" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "catalog_item_id" varchar(26) NOT NULL REFERENCES "platform_catalog_items"("id") ON DELETE CASCADE,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" varchar(16) DEFAULT 'granted' NOT NULL,
  "revoke_policy" varchar(32),
  "granted_at" varchar(32) NOT NULL,
  "revoked_at" varchar(32),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_distribution_grants_catalog_tenant_uq"
  ON "tenant_distribution_grants" ("catalog_item_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_distribution_grants_tenant_status_idx"
  ON "tenant_distribution_grants" ("tenant_id", "status");
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "origin" varchar(16) DEFAULT 'tenant' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "platform_catalog_item_id" varchar(26);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_skills_platform_catalog_idx"
  ON "enterprise_skills" ("tenant_id", "platform_catalog_item_id");

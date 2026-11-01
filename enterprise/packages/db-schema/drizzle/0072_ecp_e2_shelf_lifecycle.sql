-- ECP E2: shelf lifecycle + platform catalog versions.

ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "shelf_status" varchar(16) DEFAULT 'published' NOT NULL;
--> statement-breakpoint
UPDATE "enterprise_skills" SET "shelf_status" = 'deprecated' WHERE "status" = 'disabled';
--> statement-breakpoint
ALTER TABLE "platform_catalog_items" ADD COLUMN IF NOT EXISTS "shelf_status" varchar(16) DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_catalog_items" ADD COLUMN IF NOT EXISTS "effective_version_id" varchar(26);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_catalog_items_shelf_status_idx"
  ON "platform_catalog_items" ("shelf_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_catalog_item_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "catalog_item_id" varchar(26) NOT NULL REFERENCES "platform_catalog_items"("id") ON DELETE CASCADE,
  "version" varchar(32) DEFAULT '0.0.0' NOT NULL,
  "bundle_uri" text,
  "bundle_digest" varchar(128),
  "scan_verdict" varchar(16),
  "scan_source" varchar(32),
  "scanned_at" varchar(32),
  "scanned_by" varchar(128),
  "scan_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "shelf_status" varchar(16) DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_catalog_item_versions_catalog_version_uq"
  ON "platform_catalog_item_versions" ("catalog_item_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_catalog_item_versions_catalog_idx"
  ON "platform_catalog_item_versions" ("catalog_item_id");
--> statement-breakpoint
INSERT INTO "platform_catalog_item_versions" (
  "id",
  "catalog_item_id",
  "version",
  "bundle_uri",
  "bundle_digest",
  "shelf_status",
  "scan_findings",
  "created_at",
  "updated_at"
)
SELECT
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 26),
  "id",
  "version",
  "bundle_uri",
  "bundle_digest",
  CASE WHEN "status" = 'disabled' THEN 'deprecated' ELSE 'published' END,
  '[]'::jsonb,
  "created_at",
  "updated_at"
FROM "platform_catalog_items"
WHERE NOT EXISTS (
  SELECT 1 FROM "platform_catalog_item_versions" v WHERE v."catalog_item_id" = "platform_catalog_items"."id"
);
--> statement-breakpoint
UPDATE "platform_catalog_items" pci
SET
  "shelf_status" = CASE WHEN pci."status" = 'disabled' THEN 'deprecated' ELSE 'published' END,
  "effective_version_id" = (
    SELECT v."id"
    FROM "platform_catalog_item_versions" v
    WHERE v."catalog_item_id" = pci."id"
    ORDER BY v."updated_at" DESC
    LIMIT 1
  )
WHERE pci."effective_version_id" IS NULL;

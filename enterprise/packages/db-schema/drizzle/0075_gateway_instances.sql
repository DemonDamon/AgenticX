CREATE TABLE IF NOT EXISTS "gateway_instances" (
  "instance_id" varchar(255) PRIMARY KEY NOT NULL,
  "tenant_scope" varchar(255) DEFAULT '' NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "status_json" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_instances_last_seen_idx" ON "gateway_instances" ("last_seen_at");

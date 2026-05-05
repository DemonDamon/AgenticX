CREATE TABLE "policy_publish_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"summary" jsonb,
	"publisher" varchar(26),
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rule_packs" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" varchar(512),
	"source" varchar(16) DEFAULT 'custom' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"applies_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rule_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"rule_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"author" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"code" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"action" varchar(16) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"message" varchar(512),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applies_to" jsonb,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"updated_by" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_publish_events" ADD CONSTRAINT "policy_publish_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_packs" ADD CONSTRAINT "policy_rule_packs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_versions" ADD CONSTRAINT "policy_rule_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rule_versions" ADD CONSTRAINT "policy_rule_versions_rule_id_policy_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."policy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_pack_id_policy_rule_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."policy_rule_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_publish_events_tenant_version_uq" ON "policy_publish_events" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE INDEX "policy_publish_events_tenant_published_idx" ON "policy_publish_events" USING btree ("tenant_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_packs_tenant_code_uq" ON "policy_rule_packs" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "policy_rule_packs_tenant_updated_idx" ON "policy_rule_packs" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_versions_tenant_rule_version_uq" ON "policy_rule_versions" USING btree ("tenant_id","rule_id","version");--> statement-breakpoint
CREATE INDEX "policy_rule_versions_tenant_rule_idx" ON "policy_rule_versions" USING btree ("tenant_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rules_tenant_pack_code_uq" ON "policy_rules" USING btree ("tenant_id","pack_id","code");--> statement-breakpoint
CREATE INDEX "policy_rules_tenant_status_idx" ON "policy_rules" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "policy_rules_tenant_pack_idx" ON "policy_rules" USING btree ("tenant_id","pack_id");--> statement-breakpoint
CREATE INDEX "policy_rules_tenant_updated_idx" ON "policy_rules" USING btree ("tenant_id","updated_at");
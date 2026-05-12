CREATE TABLE "enterprise_runtime_model_providers" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"provider_id" text NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_cipher" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"route" varchar(64) DEFAULT 'third-party' NOT NULL,
	"env_key" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_runtime_mp_tenant_prov_uk" ON "enterprise_runtime_model_providers" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE TABLE "enterprise_runtime_user_visible_models" (
	"tenant_id" varchar(26) NOT NULL,
	"assignment_key" text NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_runtime_uvm_pk" PRIMARY KEY("tenant_id","assignment_key","model_id")
);--> statement-breakpoint
CREATE TABLE "enterprise_runtime_token_quotas" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "enterprise_runtime_policy_snapshots" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "auth_refresh_sessions" (
	"session_id" varchar(160) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"dept_id" varchar(26),
	"email" text NOT NULL,
	"scopes_json" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "auth_refresh_sessions_expires_idx" ON "auth_refresh_sessions" USING btree ("expires_at");--> statement-breakpoint

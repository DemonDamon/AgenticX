CREATE TABLE "gateway_channels" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"provider_type" varchar(32) DEFAULT 'openai' NOT NULL,
	"base_url" text NOT NULL,
	"api_key_cipher" text DEFAULT '' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"supported_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_channels_tenant_name_uk" ON "gateway_channels" USING btree ("tenant_id","name");

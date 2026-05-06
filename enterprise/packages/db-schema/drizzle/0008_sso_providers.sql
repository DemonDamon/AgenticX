CREATE TABLE "sso_providers" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "provider_id" varchar(64) NOT NULL,
  "display_name" varchar(128) NOT NULL,
  "issuer" varchar(512) NOT NULL,
  "client_id" varchar(256) NOT NULL,
  "client_secret_encrypted" varchar(4096),
  "redirect_uri" varchar(512) NOT NULL,
  "scopes" jsonb DEFAULT '["openid","profile","email"]'::jsonb NOT NULL,
  "claim_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_role_codes" jsonb DEFAULT '["member"]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_by" varchar(26),
  "updated_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_providers"
  ADD CONSTRAINT "sso_providers_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "sso_providers_tenant_provider_uq"
  ON "sso_providers" USING btree ("tenant_id", "provider_id");
--> statement-breakpoint
CREATE INDEX "sso_providers_tenant_enabled_idx"
  ON "sso_providers" USING btree ("tenant_id", "enabled");

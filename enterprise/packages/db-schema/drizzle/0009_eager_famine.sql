ALTER TABLE "sso_providers" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_providers" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_providers" ALTER COLUMN "redirect_uri" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD COLUMN "protocol" varchar(16) DEFAULT 'oidc' NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD COLUMN "saml_config" jsonb;--> statement-breakpoint
CREATE INDEX "sso_providers_tenant_protocol_idx" ON "sso_providers" USING btree ("tenant_id","protocol");--> statement-breakpoint
UPDATE "sso_providers" SET "protocol" = 'oidc' WHERE "protocol" IS NULL;
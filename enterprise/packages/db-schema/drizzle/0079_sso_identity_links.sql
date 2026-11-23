CREATE TABLE "sso_identity_links" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "identity_hash" varchar(64) NOT NULL,
  "provider_hash" varchar(64) NOT NULL,
  "provider_id" varchar(64) NOT NULL,
  "issuer" varchar(512) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sso_identity_links_pk" PRIMARY KEY ("tenant_id", "identity_hash"),
  CONSTRAINT "sso_identity_links_user_tenant_fk" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sso_identity_links_provider_user_uq" ON "sso_identity_links" ("tenant_id", "provider_hash", "user_id");
--> statement-breakpoint
CREATE INDEX "sso_identity_links_tenant_user_idx" ON "sso_identity_links" ("tenant_id", "user_id");

ALTER TABLE "enterprise_agents" ADD COLUMN "lifecycle" varchar(16) DEFAULT 'published' NOT NULL;
ALTER TABLE "enterprise_agents" ADD COLUMN "origin" varchar(16) DEFAULT 'enterprise' NOT NULL;
ALTER TABLE "enterprise_agents" ADD COLUMN "owner_user_id" varchar(26);
ALTER TABLE "enterprise_agents" ADD COLUMN "local_avatar_id" varchar(64);
CREATE UNIQUE INDEX "enterprise_agents_owner_avatar_uq" ON "enterprise_agents" ("tenant_id", "owner_user_id", "local_avatar_id");

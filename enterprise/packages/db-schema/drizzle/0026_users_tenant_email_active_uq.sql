-- Allow re-creating a soft-deleted user with the same email (Issue #24).
DROP INDEX IF EXISTS "users_tenant_email_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_active_uq" ON "users" USING btree ("tenant_id","email") WHERE ("is_deleted" = false AND "deleted_at" IS NULL);

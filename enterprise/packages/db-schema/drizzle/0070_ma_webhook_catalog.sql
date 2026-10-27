-- Webhook 端点描述与自动停用。时间列与 ma_webhooks 既有 timestamptz 列同型。
ALTER TABLE "ma_webhooks" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ma_webhooks" ADD COLUMN IF NOT EXISTS "disabled_reason" varchar(64);
--> statement-breakpoint
ALTER TABLE "ma_webhooks" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ma_webhooks" ADD COLUMN IF NOT EXISTS "failure_reset_at" timestamp with time zone;

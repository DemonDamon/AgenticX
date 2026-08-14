CREATE TABLE IF NOT EXISTS "enterprise_web_search_daily_quota" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  "max_provider_calls" integer DEFAULT 0 NOT NULL,
  "usage_day" varchar(10) DEFAULT '' NOT NULL,
  "provider_calls_used" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

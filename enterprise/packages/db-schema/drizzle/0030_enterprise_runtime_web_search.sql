CREATE TABLE IF NOT EXISTS "enterprise_runtime_web_search" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "provider" varchar(32) DEFAULT 'duckduckgo' NOT NULL,
  "api_key_cipher" text DEFAULT '' NOT NULL,
  "max_results" integer DEFAULT 5 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

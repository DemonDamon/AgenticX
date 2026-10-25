-- Managed Agents 记忆库。唯一物理写入方：admin-console（agent-runtime 经 /api/internal/ma/memory-stores/* 写入）。
-- ma_memories.version 是 CAS 版本号；每次变更追加一条不可变 ma_memory_versions。
-- path_hash = sha256(NFC path) hex，用于唯一约束（MySQL 无法对 varchar(1024) 建唯一索引）。
CREATE TABLE IF NOT EXISTS "ma_memory_stores" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" varchar(1024),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_by" varchar(26),
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_stores_tenant_status_idx"
  ON "ma_memory_stores" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_memories" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "store_id" varchar(26) NOT NULL REFERENCES "ma_memory_stores"("id") ON DELETE CASCADE,
  "path" varchar(1024) NOT NULL,
  "path_hash" varchar(64) NOT NULL,
  "content" text NOT NULL,
  "content_sha256" varchar(64) NOT NULL,
  "size_bytes" integer NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "last_actor_kind" varchar(16) NOT NULL,
  "last_actor_user_id" varchar(26),
  "last_session_id" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_memories_store_path_uq"
  ON "ma_memories" ("store_id", "path_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memories_tenant_store_idx"
  ON "ma_memories" ("tenant_id", "store_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_memory_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "store_id" varchar(26) NOT NULL REFERENCES "ma_memory_stores"("id") ON DELETE CASCADE,
  "memory_id" varchar(26) NOT NULL,
  "version" integer NOT NULL,
  "operation" varchar(16) NOT NULL,
  "path" varchar(1024),
  "path_hash" varchar(64),
  "content" text,
  "content_sha256" varchar(64),
  "size_bytes" integer,
  "actor_kind" varchar(16) NOT NULL,
  "actor_user_id" varchar(26),
  "source_session_id" varchar(26),
  "redacted" boolean DEFAULT false NOT NULL,
  "redacted_at" timestamp with time zone,
  "redacted_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_memory_versions_memory_version_uq"
  ON "ma_memory_versions" ("memory_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_versions_store_time_idx"
  ON "ma_memory_versions" ("store_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_versions_tenant_session_idx"
  ON "ma_memory_versions" ("tenant_id", "source_session_id");

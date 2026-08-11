CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_session_time_idx"
  ON "portal_request_logs" ("tenant_id", "session_id", "log_time");

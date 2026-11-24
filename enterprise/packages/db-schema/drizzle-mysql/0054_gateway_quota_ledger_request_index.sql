CREATE INDEX `gateway_quota_ledger_request_idx` ON `gateway_quota_ledger` (`tenant_id`, `scope_type`, `scope_id`, `period`, `request_id`, `event`);

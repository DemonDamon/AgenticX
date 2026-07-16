ALTER TABLE `gateway_audit_events`
  ADD COLUMN `checksum_version` varchar(16) NOT NULL DEFAULT 'v1',
  ADD COLUMN `checksum_payload` text;

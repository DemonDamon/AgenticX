-- 技能的安全扫描结论留痕。scan_verdict 为 NULL = 从未扫过（手工登记的技能）。
--
-- MySQL 不支持 ADD COLUMN IF NOT EXISTS，重跑会报 1060。这些文件按 journal 的
-- folderMillis 判定是否已应用，正常路径下不会重跑；手工补执行时按需跳过已存在的列。
--
-- 不写 DEFAULT CHARSET/COLLATE：写了会覆盖库默认、取到服务器级 collation，
-- 和 tenants.id 对不上就是外键 errno 3780。什么都不写反而永远正确。

ALTER TABLE `enterprise_skills` ADD COLUMN `scan_verdict` varchar(16) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD COLUMN `scan_source` varchar(32) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD COLUMN `scanned_at` varchar(32) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD COLUMN `scanned_by` varchar(128) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD COLUMN `scan_findings` json NOT NULL DEFAULT (JSON_ARRAY());

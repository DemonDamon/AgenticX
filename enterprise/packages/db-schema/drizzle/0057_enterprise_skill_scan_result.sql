-- 技能的安全扫描结论留痕。
--
-- scan_verdict 为 NULL 表示从未扫过——手工登记的技能就是这个状态。货架上必须能把它
-- 和「扫过且判定安全」区分开，否则管理员会把「没查过」看成「查过没问题」。
--
-- 企业侧是一个人决定、全公司承受，所以除了结论还要记按什么可信度扫的、谁扫的、何时扫的。

ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "scan_verdict" varchar(16);
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "scan_source" varchar(32);
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "scanned_at" varchar(32);
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "scanned_by" varchar(128);
--> statement-breakpoint
ALTER TABLE "enterprise_skills" ADD COLUMN IF NOT EXISTS "scan_findings" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- ma_work_items 增加 Worker inbox 游标，供托管运行时的 Work Queue 使用。
-- inbox_after_seq：本工作项从哪个 seq 之后投递用户事件；consumed_through_seq：结束时已处理到的 seq。
ALTER TABLE "ma_work_items" ADD COLUMN IF NOT EXISTS "inbox_after_seq" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ma_work_items" ADD COLUMN IF NOT EXISTS "consumed_through_seq" bigint;

/**
 * 个人关闭记录：一个用户把企业给他的什么东西关掉了。
 *
 * 能力和模型是同一件事——「企业给了，本人不想要」——只记「关掉了什么」，
 * 没有反向的表。用户无权开启企业没给的东西，所以「打开」只是删掉这一行。
 *
 * `subject` 沿用能力 id 的前缀写法，扩出第三种：
 *
 *     mcp:<ulid>  /  skill:<ulid>  /  model:<provider>/<name>
 */
import { index, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const enterpriseUserOptOuts = mysqlTable(
  "enterprise_user_opt_outs",
  {
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /** `mcp:<ulid>` / `skill:<ulid>` / `model:<provider>/<name>` */
    subject: varchar("subject", { length: 256 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId, table.subject] }),
    tenantUserIdx: index("enterprise_user_opt_outs_tenant_user_idx").on(table.tenantId, table.userId),
  })
);

export type EnterpriseUserOptOutRow = typeof enterpriseUserOptOuts.$inferSelect;

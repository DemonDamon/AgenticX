/**
 * 功能级分配：联网搜索、深度研究这类「谁能用」的开关。
 *
 * 与可见模型、能力包共用同一套分配键（`all` / `dept:<id>` / `group:<ulid>` / 用户
 * ulid / `email:<addr>`），所以管理员在三个地方看到的是同一种范围选择器，而不是
 * 每个功能各发明一套。
 *
 * 语义与可见模型一致：**没配过 = 全员可用**（只要租户开了），配了 = 只有命中的人
 * 可用。默认放开是刻意的——这类功能是基础能力，管理员打开开关就是想让大家用；要求
 * 逐个分配才能用，等于每加一个人都得记得来这里点一次。
 */
import { index, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const enterpriseFeatureAssignments = mysqlTable(
  "enterprise_feature_assignments",
  {
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** `web_search` / `deep_research`。 */
    feature: varchar("feature", { length: 64 }).notNull(),
    assignmentKey: varchar("assignment_key", { length: 128 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.feature, table.assignmentKey] }),
    tenantFeatureIdx: index("enterprise_feature_assignments_tenant_feature_idx").on(
      table.tenantId,
      table.feature
    ),
  })
);

export type EnterpriseFeatureAssignmentRow = typeof enterpriseFeatureAssignments.$inferSelect;

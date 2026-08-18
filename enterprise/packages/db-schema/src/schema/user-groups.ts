/**
 * 用户组：可以被分配能力的一等主体。
 *
 * 此前用户组只是 `enterprise_runtime_token_quotas.config` 这个 JSON 里的一个字段
 * （`groups[<id>].memberIds`），没有表、没有外键、没有索引。代价很具体：删掉一个
 * 用户没法级联清理他的组成员身份（要靠一个 removeUserFromAllGroups 去全表改写
 * JSON），而且能力包想引用一个组根本无从引用。
 *
 * 提成实体之后，`group:<ulid>` 就能和 `all` / `dept:<id>` / 用户 ulid 并列，成为
 * 同一套分配键里的一种，各功能只管拿到键集合之后查自己的表。
 *
 * 组的语义是**授予**：属于多个组取并集，多一个组只会多一份能力。部门仍然是上限
 * （级联收窄），个人仍然只能关。三者方向不同但各自单一，不会互相翻转含义。
 */
import { index, pgTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const enterpriseUserGroups = pgTable(
  "enterprise_user_groups",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    description: text("description"),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("enterprise_user_groups_tenant_name_uq").on(table.tenantId, table.name),
  })
);

/** 成员关系。外键到 users，删人时成员身份自动消失，不需要额外清理代码。 */
export const enterpriseUserGroupMembers = pgTable(
  "enterprise_user_group_members",
  {
    groupId: ulid("group_id")
      .notNull()
      .references(() => enterpriseUserGroups.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 26 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.userId] }),
    userIdx: index("enterprise_user_group_members_user_idx").on(table.userId),
  })
);

export type EnterpriseUserGroupRow = typeof enterpriseUserGroups.$inferSelect;
export type NewEnterpriseUserGroupRow = typeof enterpriseUserGroups.$inferInsert;
export type EnterpriseUserGroupMemberRow = typeof enterpriseUserGroupMembers.$inferSelect;

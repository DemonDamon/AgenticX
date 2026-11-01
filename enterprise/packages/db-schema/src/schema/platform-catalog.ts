/**
 * 平台能力目录与跨租户分发 grant/revoke（ECP E1）。
 *
 * 目录项与租户 grant 落在平台层；租户侧 `enterprise_skills` 通过 origin 标记只读元数据。
 */
import { index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

/** 平台目录条目（阶段 1 以 skill 为主）。 */
export const platformCatalogItems = pgTable(
  "platform_catalog_items",
  {
    id: ulid("id").primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull(),
    displayName: varchar("display_name", { length: 128 }),
    description: text("description"),
    resourceType: varchar("resource_type", { length: 32 }).notNull().default("skill"),
    version: varchar("version", { length: 32 }).notNull().default("0.0.0"),
    bundleUri: text("bundle_uri"),
    bundleDigest: varchar("bundle_digest", { length: 128 }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => ({
    slugUq: uniqueIndex("platform_catalog_items_slug_uq").on(table.slug),
    statusIdx: index("platform_catalog_items_status_idx").on(table.status),
  }),
);

/** 租户分发授权；revoke 策略在撤销时写入。 */
export const tenantDistributionGrants = pgTable(
  "tenant_distribution_grants",
  {
    id: ulid("id").primaryKey(),
    catalogItemId: ulid("catalog_item_id")
      .notNull()
      .references(() => platformCatalogItems.id, { onDelete: "cascade" }),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull().default("granted"),
    revokePolicy: varchar("revoke_policy", { length: 32 }),
    grantedAt: varchar("granted_at", { length: 32 }).notNull(),
    revokedAt: varchar("revoked_at", { length: 32 }),
    ...auditColumns,
  },
  (table) => ({
    catalogTenantUq: uniqueIndex("tenant_distribution_grants_catalog_tenant_uq").on(
      table.catalogItemId,
      table.tenantId,
    ),
    tenantStatusIdx: index("tenant_distribution_grants_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),
  }),
);

export type PlatformCatalogItemRow = typeof platformCatalogItems.$inferSelect;
export type TenantDistributionGrantRow = typeof tenantDistributionGrants.$inferSelect;

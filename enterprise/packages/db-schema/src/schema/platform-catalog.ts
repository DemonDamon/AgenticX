/**
 * 平台能力目录与跨租户分发 grant/revoke（ECP E1 + E2 货架/版本）。
 */
import { index, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

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
    /** 与 effectiveVersion 行同步，便于列表展示。 */
    version: varchar("version", { length: 32 }).notNull().default("0.0.0"),
    bundleUri: text("bundle_uri"),
    bundleDigest: varchar("bundle_digest", { length: 128 }),
    /** E1 租户开关镜像；E2 以 shelfStatus 为分发门禁。 */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    shelfStatus: varchar("shelf_status", { length: 16 }).notNull().default("draft"),
    effectiveVersionId: ulid("effective_version_id"),
    ...auditColumns,
  },
  (table) => ({
    slugUq: uniqueIndex("platform_catalog_items_slug_uq").on(table.slug),
    statusIdx: index("platform_catalog_items_status_idx").on(table.status),
    shelfStatusIdx: index("platform_catalog_items_shelf_status_idx").on(table.shelfStatus),
  }),
);

/** 目录项多版本产物；生效版本由 platform_catalog_items.effective_version_id 指向。 */
export const platformCatalogItemVersions = pgTable(
  "platform_catalog_item_versions",
  {
    id: ulid("id").primaryKey(),
    catalogItemId: ulid("catalog_item_id")
      .notNull()
      .references(() => platformCatalogItems.id, { onDelete: "cascade" }),
    version: varchar("version", { length: 32 }).notNull().default("0.0.0"),
    bundleUri: text("bundle_uri"),
    bundleDigest: varchar("bundle_digest", { length: 128 }),
    scanVerdict: varchar("scan_verdict", { length: 16 }),
    scanSource: varchar("scan_source", { length: 32 }),
    scannedAt: varchar("scanned_at", { length: 32 }),
    scannedBy: varchar("scanned_by", { length: 128 }),
    scanFindings: jsonb("scan_findings").notNull().default([]).$type<unknown[]>(),
    shelfStatus: varchar("shelf_status", { length: 16 }).notNull().default("draft"),
    ...auditColumns,
  },
  (table) => ({
    catalogVersionUq: uniqueIndex("platform_catalog_item_versions_catalog_version_uq").on(
      table.catalogItemId,
      table.version,
    ),
    catalogIdx: index("platform_catalog_item_versions_catalog_idx").on(table.catalogItemId),
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
export type PlatformCatalogItemVersionRow = typeof platformCatalogItemVersions.$inferSelect;
export type TenantDistributionGrantRow = typeof tenantDistributionGrants.$inferSelect;

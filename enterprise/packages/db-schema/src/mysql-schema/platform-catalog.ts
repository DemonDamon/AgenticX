/**
 * 平台能力目录与跨租户分发 grant/revoke（ECP E1 + E2 货架/版本）。
 */
import { index, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const platformCatalogItems = mysqlTable(
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

export const platformCatalogItemVersions = mysqlTable(
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
    scanFindings: json("scan_findings").notNull().default([]).$type<unknown[]>(),
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

export const tenantDistributionGrants = mysqlTable(
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

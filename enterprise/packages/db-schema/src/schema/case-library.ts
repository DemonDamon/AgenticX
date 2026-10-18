/**
 * Enterprise case library. A submitted package stays private until an admin
 * archives it and then publishes it for the tenant.
 *
 * Author: Damon Li
 */
import { index, jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const enterpriseCases = pgTable(
  "enterprise_cases",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 128 }).notNull(),
    summary: text("summary").notNull().default(""),
    sourceRepo: varchar("source_repo", { length: 512 }).notNull().default(""),
    /** submitted / reviewing / archived / published */
    status: varchar("status", { length: 16 }).notNull().default("submitted"),
    submitterUserId: varchar("submitter_user_id", { length: 26 }).notNull(),
    manifest: jsonb("manifest").notNull().default({}).$type<Record<string, unknown>>(),
    packagePath: text("package_path").notNull().default(""),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("enterprise_cases_tenant_status_idx").on(table.tenantId, table.status),
  }),
);

export type EnterpriseCaseRow = typeof enterpriseCases.$inferSelect;

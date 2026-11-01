/**
 * ECP E4 · 租户级能力分发策略（安装副本开关，默认关）
 */
import { boolean, pgTable } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const ecpTenantSettings = pgTable("ecp_tenant_settings", {
  tenantId: ulid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  installCopyEnabled: boolean("install_copy_enabled").notNull().default(false),
  ...auditColumns,
});

export type EcpTenantSettingsRow = typeof ecpTenantSettings.$inferSelect;

/** Immutable external identity links; raw fields are verified after hashed-key lookup. */
import { foreignKey, index, mysqlTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const ssoIdentityLinks = mysqlTable("sso_identity_links", {
  tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  identityHash: varchar("identity_hash", { length: 64 }).notNull(),
  providerHash: varchar("provider_hash", { length: 64 }).notNull(),
  providerId: varchar("provider_id", { length: 64 }).notNull(),
  issuer: varchar("issuer", { length: 512 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  userId: ulid("user_id").notNull(),
  ...auditColumns,
}, (table) => ({
  pk: primaryKey({ columns: [table.tenantId, table.identityHash], name: "sso_identity_links_pk" }),
  providerUserUq: uniqueIndex("sso_identity_links_provider_user_uq").on(table.tenantId, table.providerHash, table.userId),
  userTenantFk: foreignKey({ columns: [table.userId, table.tenantId], foreignColumns: [users.id, users.tenantId], name: "sso_identity_links_user_tenant_fk" }).onDelete("cascade"),
  tenantUserIdx: index("sso_identity_links_tenant_user_idx").on(table.tenantId, table.userId),
}));
export type SsoIdentityLinkRow = typeof ssoIdentityLinks.$inferSelect;

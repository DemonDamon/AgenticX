import { boolean, index, jsonb, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export type SsoProviderClaimMapping = {
  email?: string;
  name?: string;
  dept?: string;
  roles?: string;
  externalId?: string;
};

export type SsoProviderRowScopes = string[];
export type SsoProviderDefaultRoleCodes = string[];

export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 128 }).notNull(),
    issuer: varchar("issuer", { length: 512 }).notNull(),
    clientId: varchar("client_id", { length: 256 }).notNull(),
    clientSecretEncrypted: varchar("client_secret_encrypted", { length: 4096 }),
    redirectUri: varchar("redirect_uri", { length: 512 }).notNull(),
    scopes: jsonb("scopes").$type<SsoProviderRowScopes>().notNull().default(["openid", "profile", "email"]),
    claimMapping: jsonb("claim_mapping").$type<SsoProviderClaimMapping>().notNull().default({}),
    defaultRoleCodes: jsonb("default_role_codes").$type<SsoProviderDefaultRoleCodes>().notNull().default(["member"]),
    enabled: boolean("enabled").notNull().default(false),
    createdBy: ulid("created_by"),
    updatedBy: ulid("updated_by"),
    ...auditColumns,
  },
  (table) => ({
    tenantProviderUq: uniqueIndex("sso_providers_tenant_provider_uq").on(table.tenantId, table.providerId),
    tenantEnabledIdx: index("sso_providers_tenant_enabled_idx").on(table.tenantId, table.enabled),
  })
);

export type SsoProviderRow = typeof ssoProviders.$inferSelect;
export type NewSsoProviderRow = typeof ssoProviders.$inferInsert;

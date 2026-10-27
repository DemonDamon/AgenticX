/**
 * 托管智能体凭证库（MySQL）。只由 admin-console（iam-core）写入。
 * 密钥列只存信封密文；读接口永不返回密文或明文。
 */
import { datetime, index, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maVaults = mysqlTable(
  "ma_vaults",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    description: text("description"),
    metadata: json("metadata").notNull().default({}).$type<Record<string, string>>(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdBy: varchar("created_by", { length: 26 }),
    archivedAt: datetime("archived_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("ma_vaults_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  }),
);

export const maCredentials = mysqlTable(
  "ma_credentials",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    vaultId: ulid("vault_id").notNull().references(() => maVaults.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }),
    type: varchar("type", { length: 32 }).notNull(),
    identityKind: varchar("identity_kind", { length: 24 }).notNull(),
    identityKey: varchar("identity_key", { length: 512 }).notNull(),
    activeIdentityKey: varchar("active_identity_key", { length: 540 }),
    publicConfig: json("public_config").notNull().default({}).$type<Record<string, unknown>>(),
    secretFields: json("secret_fields").notNull().default([]).$type<string[]>(),
    secretCiphertext: text("secret_ciphertext"),
    wrappedDek: text("wrapped_dek"),
    kekId: varchar("kek_id", { length: 32 }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    expiresAt: datetime("expires_at", { fsp: 6 }),
    lastRotatedAt: datetime("last_rotated_at", { fsp: 6 }),
    lastResolvedAt: datetime("last_resolved_at", { fsp: 6 }),
    createdBy: varchar("created_by", { length: 26 }),
    archivedAt: datetime("archived_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    vaultActiveIdentityUq: uniqueIndex("ma_credentials_vault_active_identity_uq").on(table.vaultId, table.activeIdentityKey),
    tenantVaultIdx: index("ma_credentials_tenant_vault_idx").on(table.tenantId, table.vaultId, table.createdAt),
  }),
);

export type MaVaultRow = typeof maVaults.$inferSelect;
export type MaCredentialRow = typeof maCredentials.$inferSelect;

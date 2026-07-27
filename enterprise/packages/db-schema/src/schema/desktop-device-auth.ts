import { bigint, index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

import { auditColumns } from "./_shared";

/**
 * Near Desktop browser device-authorization intermediate state.
 * PAT plaintext is never persisted; only issued api_tokens.id is stored after delivery.
 */
export const desktopDeviceAuth = pgTable(
  "desktop_device_auth",
  {
    deviceId: varchar("device_id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    deviceSecretHash: varchar("device_secret_hash", { length: 128 }).notNull(),
    deviceName: varchar("device_name", { length: 128 }).notNull().default("Near Desktop"),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    userId: varchar("user_id", { length: 26 }),
    deptId: varchar("dept_id", { length: 26 }),
    issuedTokenId: bigint("issued_token_id", { mode: "number" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusExpiresIdx: index("desktop_device_auth_tenant_status_expires_idx").on(
      table.tenantId,
      table.status,
      table.expiresAt,
    ),
    secretHashIdx: index("desktop_device_auth_secret_hash_idx").on(table.deviceSecretHash),
  }),
);

export type DesktopDeviceAuthRow = typeof desktopDeviceAuth.$inferSelect;
export type NewDesktopDeviceAuthRow = typeof desktopDeviceAuth.$inferInsert;

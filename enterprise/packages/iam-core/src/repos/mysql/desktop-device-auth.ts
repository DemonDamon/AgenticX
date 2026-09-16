import { desktopDeviceAuth } from "@agenticx/db-schema/mysql";
import { and, eq } from "drizzle-orm";

import type { DesktopDeviceAuthRecord, DeviceAuthStatus } from "../../desktop-device-auth-service";
import { getMysqlRepositoryDb } from "./db";

function toRecord(row: typeof desktopDeviceAuth.$inferSelect): DesktopDeviceAuthRecord {
  return {
    deviceId: row.deviceId,
    tenantId: row.tenantId,
    deviceSecretHash: row.deviceSecretHash,
    deviceName: row.deviceName,
    status: row.status as DeviceAuthStatus,
    userId: row.userId ?? null,
    deptId: row.deptId ?? null,
    issuedTokenId: row.issuedTokenId ?? null,
    expiresAt: row.expiresAt.toISOString(),
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertMysqlDesktopDeviceAuth(
  values: typeof desktopDeviceAuth.$inferInsert,
): Promise<DesktopDeviceAuthRecord> {
  const db = await getMysqlRepositoryDb();
  await db.insert(desktopDeviceAuth).values(values);
  const [row] = await db
    .select()
    .from(desktopDeviceAuth)
    .where(eq(desktopDeviceAuth.deviceId, values.deviceId))
    .limit(1);
  if (!row) throw new Error("create desktop device auth failed");
  return toRecord(row);
}

export async function getMysqlDesktopDeviceAuth(
  deviceId: string,
): Promise<DesktopDeviceAuthRecord | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(desktopDeviceAuth)
    .where(eq(desktopDeviceAuth.deviceId, deviceId))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function updateMysqlDesktopDeviceAuthStatus(
  deviceId: string,
  fromStatus: DeviceAuthStatus,
  patch: {
    status: DeviceAuthStatus;
    userId?: string | null;
    deptId?: string | null;
    issuedTokenId?: number | null;
    approvedAt?: Date | null;
    consumedAt?: Date | null;
  },
): Promise<DesktopDeviceAuthRecord | null> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(desktopDeviceAuth)
    .set({
      status: patch.status,
      userId: patch.userId,
      deptId: patch.deptId,
      issuedTokenId: patch.issuedTokenId,
      approvedAt: patch.approvedAt,
      consumedAt: patch.consumedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(desktopDeviceAuth.deviceId, deviceId), eq(desktopDeviceAuth.status, fromStatus)));
  const [row] = await db
    .select()
    .from(desktopDeviceAuth)
    .where(eq(desktopDeviceAuth.deviceId, deviceId))
    .limit(1);
  if (!row || row.status !== patch.status) return null;
  return toRecord(row);
}

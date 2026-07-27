/**
 * Near Desktop browser device-authorization state machine.
 *
 * States: pending → approved → issuing → consumed
 *         pending → cancelled | expired
 *         approved → expired
 *
 * PAT plaintext is issued only during poll claim completion and never stored here.
 */

import { desktopDeviceAuth as deviceTable } from "@agenticx/db-schema";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getIamDb } from "./db";
import { resolveDatabaseConfig } from "./database/config";
import {
  getMysqlDesktopDeviceAuth,
  insertMysqlDesktopDeviceAuth,
  updateMysqlDesktopDeviceAuthStatus,
} from "./repos/mysql/desktop-device-auth";

export type DeviceAuthStatus =
  | "pending"
  | "approved"
  | "issuing"
  | "consumed"
  | "cancelled"
  | "expired";

export type DesktopDeviceAuthRecord = {
  deviceId: string;
  tenantId: string;
  deviceSecretHash: string;
  deviceName: string;
  status: DeviceAuthStatus;
  userId: string | null;
  deptId: string | null;
  issuedTokenId: number | null;
  expiresAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
};

export type InitDesktopDeviceAuthInput = {
  tenantId: string;
  deviceName?: string;
  ttlSeconds?: number;
};

export type InitDesktopDeviceAuthResult = {
  record: DesktopDeviceAuthRecord;
  deviceSecret: string;
  expiresIn: number;
};

export type ApproveDesktopDeviceAuthInput = {
  deviceId: string;
  tenantId: string;
  userId: string;
  deptId?: string | null;
};

function hashSecret(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function defaultTtlSeconds(): number {
  const raw = Number(process.env.DESKTOP_DEVICE_AUTH_TTL_SECONDS ?? "600");
  if (!Number.isFinite(raw) || raw <= 0) return 600;
  return Math.floor(raw);
}

function rowToRecord(row: typeof deviceTable.$inferSelect): DesktopDeviceAuthRecord {
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
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

type DeviceAuthStore = {
  insert(values: {
    deviceId: string;
    tenantId: string;
    deviceSecretHash: string;
    deviceName: string;
    status: DeviceAuthStatus;
    expiresAt: Date;
  }): Promise<DesktopDeviceAuthRecord>;
  getById(deviceId: string): Promise<DesktopDeviceAuthRecord | null>;
  updateStatus(
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
  ): Promise<DesktopDeviceAuthRecord | null>;
};

let storeOverride: DeviceAuthStore | null = null;

/** Test-only store injection. */
export function __setDesktopDeviceAuthStoreForTests(store: DeviceAuthStore | null): void {
  storeOverride = store;
}

async function defaultStore(): Promise<DeviceAuthStore> {
  if (resolveDatabaseConfig().dialect === "mysql") {
    return {
      insert: (values) => insertMysqlDesktopDeviceAuth(values),
      getById: (deviceId) => getMysqlDesktopDeviceAuth(deviceId),
      updateStatus: (deviceId, fromStatus, patch) =>
        updateMysqlDesktopDeviceAuthStatus(deviceId, fromStatus, patch),
    };
  }

  return {
    async insert(values) {
      const db = getIamDb();
      const inserted = await db.insert(deviceTable).values(values).returning();
      const row = inserted[0];
      if (!row) throw new Error("create desktop device auth failed");
      return rowToRecord(row);
    },
    async getById(deviceId) {
      const db = getIamDb();
      const rows = await db
        .select()
        .from(deviceTable)
        .where(eq(deviceTable.deviceId, deviceId))
        .limit(1);
      return rows[0] ? rowToRecord(rows[0]) : null;
    },
    async updateStatus(deviceId, fromStatus, patch) {
      const db = getIamDb();
      const updated = await db
        .update(deviceTable)
        .set({
          status: patch.status,
          userId: patch.userId,
          deptId: patch.deptId,
          issuedTokenId: patch.issuedTokenId,
          approvedAt: patch.approvedAt,
          consumedAt: patch.consumedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(deviceTable.deviceId, deviceId), eq(deviceTable.status, fromStatus)))
        .returning();
      return updated[0] ? rowToRecord(updated[0]) : null;
    },
  };
}

async function store(): Promise<DeviceAuthStore> {
  return storeOverride ?? (await defaultStore());
}

function isExpired(record: DesktopDeviceAuthRecord, now = Date.now()): boolean {
  return new Date(record.expiresAt).getTime() <= now;
}

export async function initDesktopDeviceAuth(
  input: InitDesktopDeviceAuthInput,
): Promise<InitDesktopDeviceAuthResult> {
  const ttlSeconds = input.ttlSeconds ?? defaultTtlSeconds();
  const deviceId = randomUUID();
  const deviceSecret = randomBytes(32).toString("base64url");
  const deviceName = (input.deviceName ?? "Near Desktop").trim() || "Near Desktop";
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const record = await (
    await store()
  ).insert({
    deviceId,
    tenantId: input.tenantId,
    deviceSecretHash: hashSecret(deviceSecret),
    deviceName: deviceName.slice(0, 128),
    status: "pending",
    expiresAt,
  });
  return { record, deviceSecret, expiresIn: ttlSeconds };
}

export async function getDesktopDeviceAuth(
  deviceId: string,
): Promise<DesktopDeviceAuthRecord | null> {
  return (await store()).getById(deviceId);
}

/**
 * Lazy-expire pending/approved/issuing rows past expires_at.
 * Returns the (possibly updated) record, or null if missing.
 */
export async function ensureDesktopDeviceAuthFresh(
  deviceId: string,
): Promise<DesktopDeviceAuthRecord | null> {
  const s = await store();
  const current = await s.getById(deviceId);
  if (!current) return null;
  if (!isExpired(current)) return current;
  if (
    current.status === "pending" ||
    current.status === "approved" ||
    current.status === "issuing"
  ) {
    const expired = await s.updateStatus(deviceId, current.status, { status: "expired" });
    return expired ?? { ...current, status: "expired" };
  }
  return current;
}

export async function approveDesktopDeviceAuth(
  input: ApproveDesktopDeviceAuthInput,
): Promise<DesktopDeviceAuthRecord> {
  const s = await store();
  const current = await ensureDesktopDeviceAuthFresh(input.deviceId);
  if (!current) {
    throw Object.assign(new Error("device authorization not found"), { code: "40401" });
  }
  if (current.tenantId !== input.tenantId) {
    throw Object.assign(new Error("tenant mismatch"), { code: "40301" });
  }
  if (current.status === "expired") {
    throw Object.assign(new Error("device authorization expired"), { code: "41001" });
  }
  if (current.status !== "pending") {
    throw Object.assign(new Error("device authorization not pending"), { code: "40901" });
  }
  const approved = await s.updateStatus(input.deviceId, "pending", {
    status: "approved",
    userId: input.userId,
    deptId: input.deptId ?? null,
    approvedAt: new Date(),
  });
  if (!approved) {
    throw Object.assign(new Error("device authorization not pending"), { code: "40901" });
  }
  return approved;
}

/** Atomically claim approved → issuing for single-flight PAT issuance. */
export async function claimApprovedDeviceAuth(
  deviceId: string,
): Promise<DesktopDeviceAuthRecord | null> {
  const current = await ensureDesktopDeviceAuthFresh(deviceId);
  if (!current || current.status !== "approved") return null;
  return (await store()).updateStatus(deviceId, "approved", { status: "issuing" });
}

export async function completeDesktopDeviceAuth(
  deviceId: string,
  issuedTokenId: number,
): Promise<DesktopDeviceAuthRecord | null> {
  return (await store()).updateStatus(deviceId, "issuing", {
    status: "consumed",
    issuedTokenId,
    consumedAt: new Date(),
  });
}

export async function releaseDeviceAuthClaim(
  deviceId: string,
): Promise<DesktopDeviceAuthRecord | null> {
  return (await store()).updateStatus(deviceId, "issuing", { status: "approved" });
}

export async function cancelDesktopDeviceAuth(
  deviceId: string,
  deviceSecret: string,
): Promise<DesktopDeviceAuthRecord | null> {
  const current = await ensureDesktopDeviceAuthFresh(deviceId);
  if (!current) return null;
  if (current.deviceSecretHash !== hashSecret(deviceSecret)) {
    throw Object.assign(new Error("invalid device credentials"), { code: "40101" });
  }
  if (current.status !== "pending") {
    throw Object.assign(new Error("device authorization not pending"), { code: "40901" });
  }
  return (await store()).updateStatus(deviceId, "pending", { status: "cancelled" });
}

export function verifyDesktopDeviceSecret(
  record: DesktopDeviceAuthRecord,
  deviceSecret: string,
): boolean {
  return record.deviceSecretHash === hashSecret(deviceSecret);
}

export { hashSecret as hashDesktopDeviceSecret };

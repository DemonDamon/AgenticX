import { afterEach, describe, expect, it } from "vitest";
import {
  __setDesktopDeviceAuthStoreForTests,
  approveDesktopDeviceAuth,
  cancelDesktopDeviceAuth,
  claimApprovedDeviceAuth,
  completeDesktopDeviceAuth,
  ensureDesktopDeviceAuthFresh,
  initDesktopDeviceAuth,
  releaseDeviceAuthClaim,
  verifyDesktopDeviceSecret,
  type DesktopDeviceAuthRecord,
  type DeviceAuthStatus,
} from "../desktop-device-auth-service";

function memoryStore() {
  const rows = new Map<string, DesktopDeviceAuthRecord>();
  return {
    rows,
    store: {
      async insert(values: {
        deviceId: string;
        tenantId: string;
        deviceSecretHash: string;
        deviceName: string;
        status: DeviceAuthStatus;
        expiresAt: Date;
      }) {
        const record: DesktopDeviceAuthRecord = {
          deviceId: values.deviceId,
          tenantId: values.tenantId,
          deviceSecretHash: values.deviceSecretHash,
          deviceName: values.deviceName,
          status: values.status,
          userId: null,
          deptId: null,
          issuedTokenId: null,
          expiresAt: values.expiresAt.toISOString(),
          approvedAt: null,
          consumedAt: null,
          createdAt: new Date().toISOString(),
        };
        rows.set(record.deviceId, record);
        return record;
      },
      async getById(deviceId: string) {
        return rows.get(deviceId) ?? null;
      },
      async updateStatus(
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
      ) {
        const current = rows.get(deviceId);
        if (!current || current.status !== fromStatus) return null;
        const next: DesktopDeviceAuthRecord = {
          ...current,
          status: patch.status,
          userId: patch.userId !== undefined ? patch.userId : current.userId,
          deptId: patch.deptId !== undefined ? patch.deptId : current.deptId,
          issuedTokenId:
            patch.issuedTokenId !== undefined ? patch.issuedTokenId : current.issuedTokenId,
          approvedAt: patch.approvedAt
            ? patch.approvedAt.toISOString()
            : patch.approvedAt === null
              ? null
              : current.approvedAt,
          consumedAt: patch.consumedAt
            ? patch.consumedAt.toISOString()
            : patch.consumedAt === null
              ? null
              : current.consumedAt,
        };
        rows.set(deviceId, next);
        return next;
      },
    },
  };
}

afterEach(() => {
  __setDesktopDeviceAuthStoreForTests(null);
});

describe("desktop-device-auth-service", () => {
  it("init returns secret once and stores only hash", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const result = await initDesktopDeviceAuth({ tenantId: "t1", deviceName: "Mac" });
    expect(result.deviceSecret.length).toBeGreaterThan(20);
    expect(result.record.deviceSecretHash).not.toContain(result.deviceSecret);
    expect(verifyDesktopDeviceSecret(result.record, result.deviceSecret)).toBe(true);
    expect(verifyDesktopDeviceSecret(result.record, "wrong")).toBe(false);
  });

  it("rejects wrong secret on cancel", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const { record } = await initDesktopDeviceAuth({ tenantId: "t1" });
    await expect(cancelDesktopDeviceAuth(record.deviceId, "bad-secret")).rejects.toMatchObject({
      code: "40101",
    });
  });

  it("rejects cross-tenant approve", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const { record } = await initDesktopDeviceAuth({ tenantId: "t1" });
    await expect(
      approveDesktopDeviceAuth({
        deviceId: record.deviceId,
        tenantId: "other",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "40301" });
  });

  it("lazy-expires pending rows", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const { record } = await initDesktopDeviceAuth({ tenantId: "t1", ttlSeconds: 1 });
    mem.rows.set(record.deviceId, {
      ...record,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const fresh = await ensureDesktopDeviceAuthFresh(record.deviceId);
    expect(fresh?.status).toBe("expired");
  });

  it("allows only one concurrent claim from approved", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const { record } = await initDesktopDeviceAuth({ tenantId: "t1" });
    await approveDesktopDeviceAuth({
      deviceId: record.deviceId,
      tenantId: "t1",
      userId: "u1",
      deptId: "d1",
    });
    const first = await claimApprovedDeviceAuth(record.deviceId);
    const second = await claimApprovedDeviceAuth(record.deviceId);
    expect(first?.status).toBe("issuing");
    expect(second).toBeNull();
  });

  it("releases claim back to approved on failure", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const { record } = await initDesktopDeviceAuth({ tenantId: "t1" });
    await approveDesktopDeviceAuth({
      deviceId: record.deviceId,
      tenantId: "t1",
      userId: "u1",
    });
    await claimApprovedDeviceAuth(record.deviceId);
    const released = await releaseDeviceAuthClaim(record.deviceId);
    expect(released?.status).toBe("approved");
    const reclaimed = await claimApprovedDeviceAuth(record.deviceId);
    expect(reclaimed?.status).toBe("issuing");
  });

  it("consumes once and blocks replay", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const init = await initDesktopDeviceAuth({ tenantId: "t1" });
    await approveDesktopDeviceAuth({
      deviceId: init.record.deviceId,
      tenantId: "t1",
      userId: "u1",
    });
    await claimApprovedDeviceAuth(init.record.deviceId);
    const completed = await completeDesktopDeviceAuth(init.record.deviceId, 42);
    expect(completed?.status).toBe("consumed");
    expect(completed?.issuedTokenId).toBe(42);
    const replayClaim = await claimApprovedDeviceAuth(init.record.deviceId);
    expect(replayClaim).toBeNull();
  });

  it("cancels pending with correct secret", async () => {
    const mem = memoryStore();
    __setDesktopDeviceAuthStoreForTests(mem.store);
    const init = await initDesktopDeviceAuth({ tenantId: "t1" });
    const cancelled = await cancelDesktopDeviceAuth(init.record.deviceId, init.deviceSecret);
    expect(cancelled?.status).toBe("cancelled");
  });
});

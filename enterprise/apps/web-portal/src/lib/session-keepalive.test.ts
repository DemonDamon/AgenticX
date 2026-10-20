import { describe, expect, it, vi } from "vitest";
import {
  SESSION_RENEW_WITHIN_MS,
  refreshSessionKeepalive,
  shouldRenewVisibleSession,
} from "./session-keepalive";

const now = Date.parse("2026-10-20T08:00:00.000Z");

describe("shouldRenewVisibleSession", () => {
  it("renews a visible page only inside the last 10 minutes", () => {
    expect(shouldRenewVisibleSession(now + SESSION_RENEW_WITHIN_MS - 1, now, true)).toBe(true);
    expect(shouldRenewVisibleSession(now + 30 * 60_000, now, true)).toBe(false);
    expect(shouldRenewVisibleSession(now + 60_000, now, false)).toBe(false);
    expect(shouldRenewVisibleSession(null, now, true)).toBe(true);
  });
});

describe("refreshSessionKeepalive", () => {
  it("reports the renewed principal when it still matches this page", async () => {
    const onRenewed = vi.fn();
    const onPrincipalMismatch = vi.fn();
    await refreshSessionKeepalive({
      expectedPrincipal: { tenantId: "tenant-a", userId: "user-a" },
      fetcher: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            tenantId: "tenant-a",
            userId: "user-a",
            expiresAt: "2026-10-20T09:00:00.000Z",
          },
        }),
      })),
      isActive: () => true,
      onPrincipalMismatch,
      onRenewed,
    });
    expect(onPrincipalMismatch).not.toHaveBeenCalled();
    expect(onRenewed).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      userId: "user-a",
      expiresAt: "2026-10-20T09:00:00.000Z",
    });
  });

  it("does not replace local state when the refreshed account is different", async () => {
    const onRenewed = vi.fn();
    const onPrincipalMismatch = vi.fn();
    await refreshSessionKeepalive({
      expectedPrincipal: { tenantId: "tenant-a", userId: "user-a" },
      fetcher: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            tenantId: "tenant-b",
            userId: "user-a",
            expiresAt: "2026-10-20T09:00:00.000Z",
          },
        }),
      })),
      isActive: () => true,
      onPrincipalMismatch,
      onRenewed,
    });
    expect(onPrincipalMismatch).toHaveBeenCalledOnce();
    expect(onRenewed).not.toHaveBeenCalled();
  });
});
